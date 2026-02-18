/**
 * Soroban Contract Service
 * Real on-chain interactions with the Stellar Dynasties contract.
 */

import {
    Contract,
    TransactionBuilder,
    Networks,
    Keypair,
    xdr,
    nativeToScVal,
    Address,
    scValToNative,
} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { SOROBAN_RPC_URL, NETWORK_PASSPHRASE, getContractId } from '../utils/constants';

// ---------- Types ----------
export interface OnChainGameState {
    player1: string;
    player2: string;
    player1_prestige: number;
    player2_prestige: number;
    player1_plot_verified: boolean;
    player2_plot_verified: boolean;
    player1_action: number | null;
    player2_action: number | null;
    round: number;
    ended: boolean;
    winner: string | null;
}

export interface TxResult {
    success: boolean;
    txHash?: string;
    error?: string;
    data?: any;
}

// ---------- Lazy-loaded rpc module ----------
// Use dynamic import to avoid tree-shaking issues with SorobanRpc
let _rpcModule: any = null;
async function getRpc(): Promise<any> {
    if (_rpcModule) return _rpcModule;
    try {
        // First try direct subpath import
        _rpcModule = await import('@stellar/stellar-sdk/rpc');
    } catch {
        // Fallback: import top-level and grab .rpc
        const sdk = await import('@stellar/stellar-sdk');
        _rpcModule = (sdk as any).rpc || (sdk as any).SorobanRpc || sdk;
    }
    return _rpcModule;
}

// ---------- Service ----------
class SorobanService {
    private server: any = null;
    private contractId: string;
    private networkPassphrase: string;
    private initPromise: Promise<void> | null = null;

    constructor() {
        this.contractId = getContractId('stellar-dynasties');
        this.networkPassphrase = NETWORK_PASSPHRASE || Networks.TESTNET;
        // Lazy init — don't block module loading
        this.initPromise = this.init();
    }

    private async init(): Promise<void> {
        try {
            const rpcMod = await getRpc();
            const ServerClass = rpcMod.Server || rpcMod.default?.Server;
            if (ServerClass) {
                this.server = new ServerClass(SOROBAN_RPC_URL);
                console.log('[Soroban] RPC Server initialized:', SOROBAN_RPC_URL);
            } else {
                console.warn('[Soroban] Could not find Server class in rpc module:', Object.keys(rpcMod));
            }
        } catch (err) {
            console.warn('[Soroban] RPC init failed (on-chain features disabled):', err);
        }
    }

    private async ensureReady(): Promise<void> {
        if (this.initPromise) await this.initPromise;
    }

    get isConfigured(): boolean {
        return !!this.contractId;
    }

    get contractAddress(): string {
        return this.contractId;
    }

    /**
     * Check if on-chain mode is available (server initialized + contract configured)
     */
    async isOnChainReady(): Promise<boolean> {
        await this.ensureReady();
        return !!this.server && !!this.contractId;
    }

    /**
     * Build, simulate, sign and submit a transaction
     */
    private async submitTx(
        sourceKeypair: Keypair,
        method: string,
        args: xdr.ScVal[],
    ): Promise<TxResult> {
        await this.ensureReady();
        if (!this.server) return { success: false, error: 'RPC server not initialized' };

        const rpcMod = await getRpc();

        try {
            const account = await this.server.getAccount(sourceKeypair.publicKey());
            const contract = new Contract(this.contractId);

            const tx = new TransactionBuilder(account, {
                fee: '10000000',
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call(method, ...args))
                .setTimeout(30)
                .build();

            // Simulate
            const simulated = await this.server.simulateTransaction(tx);

            const isSimError = rpcMod.Api?.isSimulationError
                ? rpcMod.Api.isSimulationError(simulated)
                : (simulated as any).error;

            if (isSimError) {
                const errMsg = (simulated as any).error || 'Simulation failed';
                console.error(`[Soroban] Simulation error for ${method}:`, errMsg);
                return { success: false, error: `Simulation failed: ${errMsg}` };
            }

            // Assemble
            const assembleFn = rpcMod.assembleTransaction || rpcMod.default?.assembleTransaction;
            const assembled = assembleFn(tx, simulated).build();

            // Sign
            assembled.sign(sourceKeypair);

            // Submit
            const sendResult = await this.server.sendTransaction(assembled);

            if (sendResult.status === 'ERROR') {
                return { success: false, error: `Send error: ${JSON.stringify(sendResult.errorResult)}` };
            }

            // Poll for result
            const txHash = sendResult.hash;
            let getResult = await this.server.getTransaction(txHash);
            let attempts = 0;
            while (getResult.status === 'NOT_FOUND' && attempts < 30) {
                await new Promise(r => setTimeout(r, 1000));
                getResult = await this.server.getTransaction(txHash);
                attempts++;
            }

            if (getResult.status === 'SUCCESS') {
                let data: any = undefined;
                if (getResult.returnValue) {
                    try {
                        data = scValToNative(getResult.returnValue);
                    } catch {
                        data = getResult.returnValue;
                    }
                }
                return { success: true, txHash, data };
            } else {
                return { success: false, txHash, error: `Transaction failed: ${getResult.status}` };
            }
        } catch (err: any) {
            console.error(`[Soroban] Error in ${method}:`, err);
            return { success: false, error: err.message || String(err) };
        }
    }

    // ---------- Contract Methods ----------

    async startSession(
        sessionId: number,
        player1Keypair: Keypair,
        player2Keypair: Keypair,
        player1Points: number = 1000,
        player2Points: number = 1000,
    ): Promise<TxResult> {
        await this.ensureReady();
        if (!this.server) return { success: false, error: 'RPC server not initialized' };

        const rpcMod = await getRpc();

        console.log(`[Soroban] Starting session ${sessionId}...`);

        const args = [
            nativeToScVal(sessionId, { type: 'u32' }),
            new Address(player1Keypair.publicKey()).toScVal(),
            new Address(player2Keypair.publicKey()).toScVal(),
            nativeToScVal(player1Points, { type: 'i128' }),
            nativeToScVal(player2Points, { type: 'i128' }),
        ];

        try {
            const account = await this.server.getAccount(player1Keypair.publicKey());
            const contract = new Contract(this.contractId);

            const tx = new TransactionBuilder(account, {
                fee: '10000000',
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('start_session', ...args))
                .setTimeout(30)
                .build();

            const simulated = await this.server.simulateTransaction(tx);

            const isSimError = rpcMod.Api?.isSimulationError
                ? rpcMod.Api.isSimulationError(simulated)
                : (simulated as any).error;

            if (isSimError) {
                const errMsg = (simulated as any).error || 'Simulation failed';
                return { success: false, error: `Simulation failed: ${errMsg}` };
            }

            const assembleFn = rpcMod.assembleTransaction || rpcMod.default?.assembleTransaction;
            const assembled = assembleFn(tx, simulated).build();

            assembled.sign(player1Keypair);
            assembled.sign(player2Keypair);

            const sendResult = await this.server.sendTransaction(assembled);
            if (sendResult.status === 'ERROR') {
                return { success: false, error: 'Send error' };
            }

            const txHash = sendResult.hash;
            let getResult = await this.server.getTransaction(txHash);
            let attempts = 0;
            while (getResult.status === 'NOT_FOUND' && attempts < 30) {
                await new Promise(r => setTimeout(r, 1000));
                getResult = await this.server.getTransaction(txHash);
                attempts++;
            }

            if (getResult.status === 'SUCCESS') {
                console.log(`[Soroban] Session ${sessionId} started! TX: ${txHash}`);
                return { success: true, txHash };
            } else {
                return { success: false, txHash, error: `Transaction failed: ${getResult.status}` };
            }
        } catch (err: any) {
            console.error('[Soroban] startSession error:', err);
            return { success: false, error: err.message || String(err) };
        }
    }

    async commitPlot(
        sessionId: number,
        playerKeypair: Keypair,
        plotHash: Uint8Array,
    ): Promise<TxResult> {
        console.log(`[Soroban] Committing plot for session ${sessionId}...`);
        const hashN32 = nativeToScVal(Buffer.from(plotHash), { type: 'bytes' });
        const args = [
            nativeToScVal(sessionId, { type: 'u32' }),
            new Address(playerKeypair.publicKey()).toScVal(),
            hashN32,
        ];
        return this.submitTx(playerKeypair, 'commit_plot', args);
    }

    async verifyPlot(
        sessionId: number,
        playerKeypair: Keypair,
        actionType: number,
        proofData: Uint8Array,
        commitment: Uint8Array,
    ): Promise<TxResult> {
        console.log(`[Soroban] Verifying plot for session ${sessionId}, action ${actionType}...`);
        const args = [
            nativeToScVal(sessionId, { type: 'u32' }),
            new Address(playerKeypair.publicKey()).toScVal(),
            nativeToScVal(actionType, { type: 'u32' }),
            nativeToScVal(Buffer.from(proofData), { type: 'bytes' }),
            nativeToScVal(Buffer.from(commitment), { type: 'bytes' }),
        ];
        return this.submitTx(playerKeypair, 'verify_plot', args);
    }

    async resolveRound(
        sessionId: number,
        callerKeypair: Keypair,
    ): Promise<TxResult> {
        console.log(`[Soroban] Resolving round for session ${sessionId}...`);
        const args = [
            nativeToScVal(sessionId, { type: 'u32' }),
        ];
        return this.submitTx(callerKeypair, 'resolve_round', args);
    }

    async getGame(sessionId: number): Promise<OnChainGameState | null> {
        await this.ensureReady();
        if (!this.server) return null;

        const rpcMod = await getRpc();

        try {
            const contract = new Contract(this.contractId);
            const dummySource = Keypair.random();
            let sourceAccount;
            try {
                sourceAccount = await this.server.getAccount(dummySource.publicKey());
            } catch {
                return null;
            }

            const tx = new TransactionBuilder(sourceAccount, {
                fee: '100',
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call('get_game', nativeToScVal(sessionId, { type: 'u32' })))
                .setTimeout(30)
                .build();

            const simulated = await this.server.simulateTransaction(tx);
            const isSimError = rpcMod.Api?.isSimulationError
                ? rpcMod.Api.isSimulationError(simulated)
                : (simulated as any).error;

            if (isSimError) return null;

            const result = (simulated as any).result;
            if (result?.retval) {
                const native = scValToNative(result.retval);
                return native as OnChainGameState;
            }
            return null;
        } catch (err) {
            console.error('[Soroban] getGame error:', err);
            return null;
        }
    }
}

// Singleton instance
export const sorobanService = new SorobanService();
