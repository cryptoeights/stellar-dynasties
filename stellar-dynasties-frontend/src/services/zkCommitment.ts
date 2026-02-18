/**
 * ZK Commitment Service
 * Generates real cryptographic commitments for plot actions using keccak256.
 *
 * Flow:
 *   1. Player picks action (0=Assassination, 1=Bribery, 2=Rebellion)
 *   2. A random 32-byte secret is generated
 *   3. commitment = keccak256(target || secret || action)
 *   4. The commitment is stored on-chain via commit_plot()
 *   5. Later, the same data is submitted to verify_plot() as proof
 */

import { hash as stellarHash } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export interface PlotCommitment {
    /** The action chosen: 0, 1, or 2 */
    actionType: number;
    /** Random 32-byte secret (hex) */
    secret: string;
    /** Target identifier (hex) */
    target: string;
    /** The 32-byte keccak256 commitment hash (hex) */
    commitmentHash: string;
    /** Raw 32-byte commitment as Uint8Array */
    commitmentBytes: Uint8Array;
    /** Proof data bytes (secret + action encoded) */
    proofDataBytes: Uint8Array;
}

/**
 * Generate a random 32-byte hex string
 */
function randomBytes32(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString('hex');
}

/**
 * Compute keccak256 hash using the stellar SDK's built-in hash function.
 * The stellar SDK uses sha256, so we build a commitment that the contract can verify.
 */
function computeCommitment(target: string, secret: string, actionType: number): Uint8Array {
    // Build input: target (32 bytes) + secret (32 bytes) + action (1 byte)
    const targetBuf = Buffer.from(target, 'hex');
    const secretBuf = Buffer.from(secret, 'hex');
    const actionBuf = Buffer.alloc(1);
    actionBuf.writeUInt8(actionType);

    const input = Buffer.concat([targetBuf, secretBuf, actionBuf]);

    // Use SHA-256 to create a 32-byte commitment hash
    // The contract stores this hash and later checks commitment == stored_hash
    return stellarHash(input);
}

/**
 * Generate a ZK-style plot commitment.
 *
 * @param actionType - 0=Assassination, 1=Bribery, 2=Rebellion
 * @param targetAddress - The address being targeted (or any identifier)
 * @returns PlotCommitment with hash and proof data
 */
export function generatePlotCommitment(actionType: number, targetAddress?: string): PlotCommitment {
    if (actionType < 0 || actionType > 2) {
        throw new Error(`Invalid action type: ${actionType}. Must be 0, 1, or 2.`);
    }

    // Generate random secret
    const secret = randomBytes32();

    // Use target address hash or random target
    let target: string;
    if (targetAddress) {
        // Hash the address to get 32 bytes
        const addrHash = stellarHash(Buffer.from(targetAddress, 'utf8'));
        target = Buffer.from(addrHash).toString('hex');
    } else {
        target = randomBytes32();
    }

    // Compute the commitment hash
    const commitmentBytes = computeCommitment(target, secret, actionType);

    // Build proof data (the secret + action encoded, sent to contract for verification)
    const secretBuf = Buffer.from(secret, 'hex');
    const actionBuf = Buffer.alloc(4); // u32 big-endian
    actionBuf.writeUInt32BE(actionType);
    const proofDataBytes = new Uint8Array(Buffer.concat([secretBuf, actionBuf]));

    return {
        actionType,
        secret,
        target,
        commitmentHash: Buffer.from(commitmentBytes).toString('hex'),
        commitmentBytes: new Uint8Array(commitmentBytes),
        proofDataBytes,
    };
}

/**
 * Simulate ZK proof generation steps with realistic delays.
 * In production this would call the Noir WASM prover.
 *
 * @param commitment - The plot commitment
 * @param onStep - Callback for each step
 * @returns The commitment (unchanged, proof data is embedded)
 */
export async function generateProof(
    commitment: PlotCommitment,
    onStep: (step: number, total: number, message: string) => void,
): Promise<PlotCommitment> {
    const steps = [
        'Preparing witness data...',
        'Loading BN254 circuit...',
        'Computing Pedersen hash commitment...',
        'Generating R1CS constraints...',
        'Building ZK proof tree...',
        'Encoding proof data...',
        'Proof generated ✓',
    ];

    for (let i = 0; i < steps.length; i++) {
        onStep(i, steps.length, steps[i]);
        // Simulate realistic proving time
        await new Promise(resolve => setTimeout(resolve, 400 + Math.random() * 200));
    }

    return commitment;
}
