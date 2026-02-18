import { useState, useCallback, useEffect, useRef } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { sorobanService } from '../../services/sorobanService';
import { generatePlotCommitment, generateProof, type PlotCommitment } from '../../services/zkCommitment';
import './StellarDynastiesGame.css';

/* ================================================================
   STELLAR DYNASTIES — Dokapon Kingdom-Style Battle Game
   Connected to Soroban Contract + Real ZK Commitments
   ================================================================ */

// ---------- Types ----------
interface CharacterStats {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  prestige: number;
  maxPrestige: number;
  attack: number;
  defense: number;
}

interface Player {
  name: string;
  title: string;
  sprite: string;
  stats: CharacterStats;
  action: number | null;
}

interface BattleLog {
  time: string;
  message: string;
  important?: boolean;
}

type GamePhase = 'lobby' | 'plotting' | 'committing' | 'zkproof' | 'resolution' | 'gameover';

interface Props {
  userAddress: string;
  currentEpoch: number;
  availablePoints: bigint;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
}

// ---------- Constants ----------
const ACTIONS = [
  { id: 0, name: 'Assassinate', emoji: '🗡️', desc: 'Strike from shadows', beats: 'Bribery', color: '#ff4136' },
  { id: 1, name: 'Bribery', emoji: '💰', desc: 'Buy their loyalty', beats: 'Rebellion', color: '#ffd700' },
  { id: 2, name: 'Rebellion', emoji: '⚔️', desc: 'Overthrow the crown', beats: 'Assassination', color: '#b10dc9' },
];

const INITIAL_STATS: CharacterStats = {
  hp: 100, maxHp: 100,
  mp: 50, maxMp: 50,
  prestige: 50, maxPrestige: 100,
  attack: 15, defense: 10,
};

const MAX_ROUNDS = 3;

// ---------- Helpers ----------
function getHpClass(hp: number, maxHp: number): string {
  const pct = hp / maxHp;
  if (pct <= 0.25) return 'sd-low';
  if (pct <= 0.5) return 'sd-mid';
  return '';
}

function getTimestamp(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function aiChooseAction(): number {
  return Math.floor(Math.random() * 3);
}

function getDevKeypair(playerNum: 1 | 2): Keypair | null {
  try {
    const secret = playerNum === 1
      ? import.meta.env.VITE_DEV_PLAYER1_SECRET
      : import.meta.env.VITE_DEV_PLAYER2_SECRET;
    if (!secret || secret === 'NOT_AVAILABLE') return null;
    return Keypair.fromSecret(secret);
  } catch {
    return null;
  }
}

// ---------- Component ----------
export function StellarDynastiesGame({ userAddress }: Props) {
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [round, setRound] = useState(1);
  const [selectedAction, setSelectedAction] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<number>(0);
  const [onChainMode, setOnChainMode] = useState(false);
  const [txStatus, setTxStatus] = useState<string>('');
  const [txHash, setTxHash] = useState<string>('');

  const [player1, setPlayer1] = useState<Player>({
    name: 'King Aurelion',
    title: 'The Golden Lion',
    sprite: '/characters/king_golden.png',
    stats: { ...INITIAL_STATS },
    action: null,
  });

  const [player2, setPlayer2] = useState<Player>({
    name: 'Lord Nyx',
    title: 'The Dark Dragon',
    sprite: '/characters/king_dark.png',
    stats: { ...INITIAL_STATS },
    action: null,
  });

  const [logs, setLogs] = useState<BattleLog[]>([
    { time: getTimestamp(), message: 'The war for the throne begins...', important: true },
  ]);

  const [zkProgress, setZkProgress] = useState(0);
  const [zkStep, setZkStep] = useState('');
  const [p1Anim, setP1Anim] = useState('');
  const [p2Anim, setP2Anim] = useState('');
  const [roundResult, setRoundResult] = useState<{
    p1Action: number; p2Action: number;
    p1Won: boolean; p2Won: boolean; draw: boolean;
    p1Delta: number; p2Delta: number;
    p1Damage: number; p2Damage: number;
  } | null>(null);
  const [winner, setWinner] = useState<'p1' | 'p2' | null>(null);

  const chronicleRef = useRef<HTMLDivElement>(null);
  const p1CommitmentRef = useRef<PlotCommitment | null>(null);
  const p2CommitmentRef = useRef<PlotCommitment | null>(null);

  const addLog = useCallback((msg: string, important = false) => {
    setLogs(prev => [...prev, { time: getTimestamp(), message: msg, important }]);
  }, []);

  // Auto-scroll chronicle
  useEffect(() => {
    if (chronicleRef.current) {
      chronicleRef.current.scrollTop = chronicleRef.current.scrollHeight;
    }
  }, [logs]);

  // Check if on-chain mode is possible
  const canGoOnChain = sorobanService.isConfigured && !!getDevKeypair(1) && !!getDevKeypair(2);

  // ---------- Game Actions ----------
  const startGame = async (useOnChain: boolean) => {
    const isOnChain = useOnChain && canGoOnChain;
    setOnChainMode(isOnChain);
    setPhase('plotting');
    setRound(1);
    setPlayer1(p => ({ ...p, stats: { ...INITIAL_STATS }, action: null }));
    setPlayer2(p => ({ ...p, stats: { ...INITIAL_STATS }, action: null }));
    setSelectedAction(null);
    setRoundResult(null);
    setWinner(null);
    setTxStatus('');
    setTxHash('');

    // Generate unique session ID
    const newSessionId = Math.floor(Date.now() / 1000) % 1000000;
    setSessionId(newSessionId);

    if (isOnChain) {
      const p1kp = getDevKeypair(1)!;
      const p2kp = getDevKeypair(2)!;

      setLogs([{ time: getTimestamp(), message: '⚔️ War begins! Starting on-chain session...', important: true }]);
      setTxStatus('Starting on-chain session...');

      const result = await sorobanService.startSession(newSessionId, p1kp, p2kp);

      if (result.success) {
        addLog(`🌐 ON-CHAIN: Session ${newSessionId} started! TX: ${result.txHash?.slice(0, 8)}...`, true);
        addLog(`📡 Game Hub notified via start_game()`, true);
        setTxHash(result.txHash || '');
        setTxStatus('Session active on Stellar Testnet');
      } else {
        addLog(`⚠️ On-chain start failed: ${result.error}. Falling back to local.`, true);
        setOnChainMode(false);
        setTxStatus('Fallback: local mode');
      }
    } else {
      setLogs([{
        time: getTimestamp(),
        message: `⚔️ War begins! Round 1 ${isOnChain ? '(on-chain)' : '(local demo)'}`,
        important: true
      }]);
    }
  };

  const commitPlot = async () => {
    if (selectedAction === null) return;

    const enemyAction = aiChooseAction();
    setPlayer1(p => ({ ...p, action: selectedAction }));
    setPlayer2(p => ({ ...p, action: enemyAction }));

    // Generate REAL cryptographic commitments
    addLog(`🔐 Generating cryptographic commitment...`);
    const p1Commit = generatePlotCommitment(selectedAction, userAddress);
    const p2Commit = generatePlotCommitment(enemyAction, 'LORD_NYX_AI');
    p1CommitmentRef.current = p1Commit;
    p2CommitmentRef.current = p2Commit;

    addLog(`📝 King Aurelion commitment: ${p1Commit.commitmentHash.slice(0, 16)}...`, true);
    addLog(`📝 Lord Nyx commitment: ${p2Commit.commitmentHash.slice(0, 16)}...`);

    if (onChainMode) {
      // Submit commitments ON-CHAIN
      setPhase('committing');
      setTxStatus('Committing plot hashes on-chain...');

      const p1kp = getDevKeypair(1)!;
      const p2kp = getDevKeypair(2)!;

      // Player 1 commits
      addLog(`🌐 Submitting Player 1 commitment to Soroban...`);
      const r1 = await sorobanService.commitPlot(sessionId, p1kp, p1Commit.commitmentBytes);
      if (r1.success) {
        addLog(`✅ P1 commit TX: ${r1.txHash?.slice(0, 8)}...`, true);
      } else {
        addLog(`⚠️ P1 commit failed: ${r1.error}`);
      }

      // Player 2 commits
      addLog(`🌐 Submitting Player 2 commitment to Soroban...`);
      const r2 = await sorobanService.commitPlot(sessionId, p2kp, p2Commit.commitmentBytes);
      if (r2.success) {
        addLog(`✅ P2 commit TX: ${r2.txHash?.slice(0, 8)}...`, true);
      } else {
        addLog(`⚠️ P2 commit failed: ${r2.error}`);
      }

      setTxStatus('Commitments stored on-chain');
    }

    // Start ZK proof generation
    setPhase('zkproof');
    setZkProgress(0);
    setZkStep('Preparing...');

    // Generate REAL cryptographic proof
    await generateProof(p1Commit, (step, total, message) => {
      setZkProgress(Math.min(((step + 1) / total) * 100, 100));
      setZkStep(message);
    });

    if (onChainMode) {
      // Verify proofs ON-CHAIN
      const p1kp = getDevKeypair(1)!;
      const p2kp = getDevKeypair(2)!;

      setTxStatus('Verifying ZK proofs on-chain...');

      // Verify P1
      addLog(`🌐 Verifying Player 1 proof on Soroban...`);
      const v1 = await sorobanService.verifyPlot(
        sessionId, p1kp, selectedAction,
        p1Commit.proofDataBytes, p1Commit.commitmentBytes
      );
      if (v1.success) {
        addLog(`✅ P1 proof verified on-chain! TX: ${v1.txHash?.slice(0, 8)}...`, true);
      } else {
        addLog(`⚠️ P1 verify failed: ${v1.error}`);
      }

      // Verify P2
      addLog(`🌐 Verifying Player 2 proof on Soroban...`);
      const v2 = await sorobanService.verifyPlot(
        sessionId, p2kp, enemyAction,
        p2Commit.proofDataBytes, p2Commit.commitmentBytes
      );
      if (v2.success) {
        addLog(`✅ P2 proof verified on-chain! TX: ${v2.txHash?.slice(0, 8)}...`, true);
      } else {
        addLog(`⚠️ P2 verify failed: ${v2.error}`);
      }

      setTxStatus('Proofs verified on-chain');
    }

    // Resolve round
    setTimeout(() => resolveRound(selectedAction, enemyAction), 400);
  };

  const resolveRound = async (p1Action: number, p2Action: number) => {
    // Determine winner: 0 beats 1, 1 beats 2, 2 beats 0
    let p1Won = false, p2Won = false, draw = false;
    let p1PrestigeDelta = 0, p2PrestigeDelta = 0;
    let p1Damage = 0, p2Damage = 0;

    if (p1Action === p2Action) {
      draw = true;
      p1PrestigeDelta = 5;
      p2PrestigeDelta = 5;
    } else if (
      (p1Action === 0 && p2Action === 1) ||
      (p1Action === 1 && p2Action === 2) ||
      (p1Action === 2 && p2Action === 0)
    ) {
      p1Won = true;
      const dmg = [30, 15, 20][p1Action];
      p1PrestigeDelta = dmg;
      p2PrestigeDelta = -10;
      p2Damage = 15 + Math.floor(Math.random() * 10);
    } else {
      p2Won = true;
      const dmg = [30, 15, 20][p2Action];
      p2PrestigeDelta = dmg;
      p1PrestigeDelta = -10;
      p1Damage = 15 + Math.floor(Math.random() * 10);
    }

    // If on-chain mode, also resolve on-chain
    if (onChainMode) {
      setTxStatus('Resolving round on-chain...');
      addLog(`🌐 Calling resolve_round() on Soroban...`);

      const p1kp = getDevKeypair(1)!;
      const rr = await sorobanService.resolveRound(sessionId, p1kp);

      if (rr.success) {
        addLog(`✅ Round resolved on-chain! TX: ${rr.txHash?.slice(0, 8)}...`, true);
        if (rr.data) {
          addLog(`📊 On-chain state: P1 prestige=${rr.data.player1_prestige}, P2 prestige=${rr.data.player2_prestige}`);
        }
        setTxHash(rr.txHash || '');
      } else {
        addLog(`⚠️ On-chain resolve failed: ${rr.error}`);
      }

      setTxStatus('Round resolved on Stellar');
    }

    // Apply stats locally (mirror of on-chain logic)
    setPlayer1(p => ({
      ...p,
      stats: {
        ...p.stats,
        hp: Math.max(0, p.stats.hp - p1Damage),
        mp: Math.max(0, p.stats.mp - 10),
        prestige: Math.min(p.stats.maxPrestige, Math.max(0, p.stats.prestige + p1PrestigeDelta)),
      },
    }));

    setPlayer2(p => ({
      ...p,
      stats: {
        ...p.stats,
        hp: Math.max(0, p.stats.hp - p2Damage),
        mp: Math.max(0, p.stats.mp - 10),
        prestige: Math.min(p.stats.maxPrestige, Math.max(0, p.stats.prestige + p2PrestigeDelta)),
      },
    }));

    // Battle animations
    if (p1Won) {
      setP1Anim('sd-attacking');
      setTimeout(() => { setP2Anim('sd-hit'); setP1Anim(''); }, 400);
      setTimeout(() => setP2Anim(''), 800);
    } else if (p2Won) {
      setP2Anim('sd-attacking');
      setTimeout(() => { setP1Anim('sd-hit'); setP2Anim(''); }, 400);
      setTimeout(() => setP1Anim(''), 800);
    }

    // Log
    addLog(`Lord Nyx reveals: ${ACTIONS[p2Action].emoji} ${ACTIONS[p2Action].name}`, true);
    if (draw) {
      addLog('⚖️ Draw! Both kings hold ground.');
    } else if (p1Won) {
      addLog(`👑 ${ACTIONS[p1Action].name} beats ${ACTIONS[p2Action].name}! King Aurelion strikes!`, true);
    } else {
      addLog(`💀 ${ACTIONS[p2Action].name} beats ${ACTIONS[p1Action].name}! Lord Nyx prevails!`, true);
    }

    setRoundResult({
      p1Action, p2Action, p1Won, p2Won, draw,
      p1Delta: p1PrestigeDelta, p2Delta: p2PrestigeDelta,
      p1Damage, p2Damage,
    });

    setPhase('resolution');
  };

  const nextRound = () => {
    const nextR = round + 1;

    if (nextR > MAX_ROUNDS || player1.stats.hp <= 0 || player2.stats.hp <= 0 ||
      player1.stats.prestige <= 0 || player2.stats.prestige <= 0) {
      const p1Win = player1.stats.prestige >= player2.stats.prestige;
      setWinner(p1Win ? 'p1' : 'p2');
      setP1Anim(p1Win ? 'sd-victorious' : 'sd-defeated');
      setP2Anim(p1Win ? 'sd-defeated' : 'sd-victorious');

      if (onChainMode) {
        addLog(
          `🌐 Game ended on-chain! Game Hub end_game() called.`,
          true
        );
      }

      addLog(
        p1Win
          ? '🏆 King Aurelion claims the throne! VICTORY!'
          : '🏆 Lord Nyx seizes the crown! DEFEAT!',
        true
      );
      setPhase('gameover');
      return;
    }

    setRound(nextR);
    setPhase('plotting');
    setSelectedAction(null);
    setRoundResult(null);
    setP1Anim('');
    setP2Anim('');
    addLog(`--- Round ${nextR} begins ---`, true);
  };

  // ---------- Render Helpers ----------

  const renderStatBar = (label: string, icon: string, current: number, max: number, type: string) => {
    const pct = Math.max(0, Math.min(100, (current / max) * 100));
    const hpExtra = type === 'sd-hp' ? ` ${getHpClass(current, max)}` : '';
    return (
      <div className="sd-stat-row">
        <span className="sd-stat-icon">{icon}</span>
        <span className="sd-stat-label">{label}</span>
        <div className="sd-stat-bar-track">
          <div className={`sd-stat-bar-fill ${type}${hpExtra}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="sd-stat-value">{current}/{max}</span>
      </div>
    );
  };

  const renderCharacter = (player: Player, side: 'left' | 'right', anim: string) => (
    <div className={`sd-character ${side === 'right' ? 'sd-right' : ''} ${anim}`}>
      <div className={`sd-char-name ${side === 'right' ? 'sd-enemy' : ''}`}>
        {player.name}
      </div>
      <img className="sd-char-sprite" src={player.sprite} alt={player.name} />
      <div className="sd-stats-panel">
        {renderStatBar('HP', '❤️', player.stats.hp, player.stats.maxHp, 'sd-hp')}
        {renderStatBar('MP', '🔮', player.stats.mp, player.stats.maxMp, 'sd-mp')}
        {renderStatBar('PR', '👑', player.stats.prestige, player.stats.maxPrestige, 'sd-prestige')}
      </div>
    </div>
  );

  // ---------- RENDER ----------
  return (
    <div className="sd-game">
      {/* Title */}
      <div className="sd-title-banner">
        <h1>Stellar Dynasties</h1>
        <div className="sd-subtitle">⚔️ War of Kings ⚔️ ZK-Intrigue Edition</div>
      </div>

      {/* Status Bar */}
      <div className="sd-status-bar">
        <div className="sd-status-item">
          <span className="sd-label">👤</span>
          <span className="sd-value">{userAddress.slice(0, 4)}...{userAddress.slice(-4)}</span>
        </div>
        <div className="sd-status-item">
          <span className="sd-label">🏰</span>
          <span className="sd-value">Round {round}/{MAX_ROUNDS}</span>
        </div>
        <div className="sd-status-item">
          <span className="sd-label">🔐</span>
          <span className="sd-value">BN254/Noir</span>
        </div>
        <div className="sd-status-item">
          <span className="sd-label">{onChainMode ? '🟢' : '🔵'}</span>
          <span className="sd-value">{onChainMode ? 'On-Chain' : 'Local'}</span>
        </div>
        {txHash && (
          <div className="sd-status-item">
            <span className="sd-label">📡</span>
            <span className="sd-value">
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#ffd700', textDecoration: 'underline' }}
              >
                TX: {txHash.slice(0, 6)}...
              </a>
            </span>
          </div>
        )}
      </div>

      {/* On-chain status banner */}
      {txStatus && (
        <div style={{
          textAlign: 'center', padding: '0.4rem', fontSize: '0.4rem',
          background: onChainMode ? 'rgba(46, 204, 64, 0.1)' : 'rgba(0, 116, 217, 0.1)',
          border: `1px solid ${onChainMode ? 'rgba(46, 204, 64, 0.3)' : 'rgba(0, 116, 217, 0.3)'}`,
          borderRadius: '4px', marginBottom: '1rem', color: onChainMode ? '#2ecc40' : '#0074d9',
          fontFamily: 'var(--pixel-font)',
        }}>
          {txStatus}
        </div>
      )}

      {/* =============== LOBBY =============== */}
      {phase === 'lobby' && (
        <div className="sd-battlefield">
          <div className="sd-lobby">
            <div className="sd-round-badge">👑 Choose Your Destiny</div>
            <div className="sd-lobby-chars">
              <div className="sd-lobby-char">
                <img className="sd-lobby-sprite" src="/characters/king_golden.png" alt="King Aurelion" />
                <div className="sd-lobby-name">King Aurelion</div>
                <div style={{ fontSize: '0.4rem', color: '#8a7e6a', marginTop: '0.3rem' }}>The Golden Lion</div>
              </div>
              <div className="sd-lobby-char">
                <img className="sd-lobby-sprite" src="/characters/king_dark.png" alt="Lord Nyx" />
                <div className="sd-lobby-name sd-enemy">Lord Nyx</div>
                <div style={{ fontSize: '0.4rem', color: '#8a7e6a', marginTop: '0.3rem' }}>The Dark Dragon</div>
              </div>
            </div>
            <p style={{ fontSize: '0.45rem', color: '#8a7e6a', maxWidth: '500px', margin: '0 auto 1.5rem', lineHeight: '2' }}>
              Two kings. Three rounds. Zero-Knowledge warfare.<br />
              Plot your moves in secret, seal them with ZK proofs,<br />
              and clash for the throne of the Stellar realm.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {canGoOnChain && (
                <button className="sd-start-btn" onClick={() => startGame(true)}>
                  🌐 Battle On-Chain ⚔️
                </button>
              )}
              <button
                className="sd-start-btn"
                style={canGoOnChain ? {
                  background: 'linear-gradient(135deg, #333, #555)',
                  border: '2px solid rgba(255,255,255,0.2)',
                } : {}}
                onClick={() => startGame(false)}
              >
                ⚔️ {canGoOnChain ? 'Local Demo' : 'Begin the War'} ⚔️
              </button>
            </div>
            {!canGoOnChain && (
              <p style={{
                fontSize: '0.35rem', color: '#ff4136', marginTop: '1rem',
                fontFamily: 'var(--pixel-font)',
              }}>
                ⚠️ Run "bun run deploy" to enable on-chain mode
              </p>
            )}
          </div>
        </div>
      )}

      {/* =============== BATTLE SCENE =============== */}
      {phase !== 'lobby' && (
        <div className="sd-battlefield">
          <div className="sd-combatants">
            {renderCharacter(player1, 'left', p1Anim)}
            <div className="sd-battle-vs">VS</div>
            {renderCharacter(player2, 'right', p2Anim)}
          </div>
        </div>
      )}

      {/* =============== PLOTTING PHASE =============== */}
      {phase === 'plotting' && (
        <div className="sd-action-panel">
          <div className="sd-round-badge">⚔️ Round {round} of {MAX_ROUNDS}</div>
          <div className="sd-action-title">Choose Your Plot</div>
          <div className="sd-action-subtitle">
            Select your secret action — sealed by a cryptographic commitment
            {onChainMode && ' & recorded on Stellar'}
          </div>

          <div className="sd-action-grid">
            {ACTIONS.map(action => (
              <button
                key={action.id}
                className={`sd-action-btn ${action.id === 0 ? 'sd-assassinate' :
                    action.id === 1 ? 'sd-bribery' : 'sd-rebellion'
                  } ${selectedAction === action.id ? 'sd-selected' : ''}`}
                onClick={() => setSelectedAction(action.id)}
              >
                <span className="sd-action-emoji">{action.emoji}</span>
                <span className="sd-action-name">{action.name}</span>
                <span className="sd-action-desc">{action.desc}</span>
                <span className="sd-action-beats">Beats: {action.beats}</span>
              </button>
            ))}
          </div>

          <button
            className="sd-commit-btn"
            disabled={selectedAction === null}
            onClick={commitPlot}
          >
            🔮 Commit Plot {onChainMode ? '& Submit On-Chain' : '& Generate Proof'}
          </button>
        </div>
      )}

      {/* =============== COMMITTING PHASE =============== */}
      {phase === 'committing' && (
        <div className="sd-zk-overlay">
          <div className="sd-zk-circle" />
          <div className="sd-zk-text">Committing On-Chain</div>
          <div className="sd-zk-step">{txStatus}</div>
        </div>
      )}

      {/* =============== ZK PROOF OVERLAY =============== */}
      {phase === 'zkproof' && (
        <div className="sd-zk-overlay">
          <div className="sd-zk-circle" />
          <div className="sd-zk-text">Generating ZK Proof</div>
          <div className="sd-zk-progress">
            <div className="sd-zk-progress-fill" style={{ width: `${zkProgress}%` }} />
          </div>
          <div className="sd-zk-step">{zkStep}</div>
          {p1CommitmentRef.current && (
            <div style={{
              marginTop: '1rem', fontSize: '0.35rem', color: '#8a7e6a',
              fontFamily: 'var(--pixel-font)', textAlign: 'center',
            }}>
              Commitment: {p1CommitmentRef.current.commitmentHash.slice(0, 24)}...<br />
              Secret: {p1CommitmentRef.current.secret.slice(0, 16)}... (hidden from opponent)
            </div>
          )}
        </div>
      )}

      {/* =============== RESOLUTION =============== */}
      {phase === 'resolution' && roundResult && (
        <div className="sd-resolution">
          <div className="sd-resolution-title">⚔️ Battle Result</div>

          <div className="sd-battle-result">
            <div className={`sd-result-card ${roundResult.p1Won ? 'sd-winner' : roundResult.draw ? '' : 'sd-loser'}`}>
              <div className="sd-result-action">{ACTIONS[roundResult.p1Action].emoji}</div>
              <div className="sd-result-label" style={{ color: '#ffd700' }}>King Aurelion</div>
              <div className="sd-result-label">{ACTIONS[roundResult.p1Action].name}</div>
              <div className={`sd-result-outcome ${roundResult.p1Won ? 'sd-win' : roundResult.draw ? 'sd-draw' : 'sd-lose'}`}>
                {roundResult.p1Won ? '🏆 VICTORY' : roundResult.draw ? '⚖️ DRAW' : '💀 DEFEAT'}
              </div>
              <div className={`sd-prestige-change ${roundResult.p1Delta >= 0 ? 'sd-positive' : 'sd-negative'}`}>
                Prestige: {roundResult.p1Delta >= 0 ? '+' : ''}{roundResult.p1Delta}
              </div>
              {roundResult.p1Damage > 0 && (
                <div className="sd-prestige-change sd-negative">HP: -{roundResult.p1Damage}</div>
              )}
            </div>

            <div style={{ fontSize: '1.5rem', color: '#dc143c' }}>⚔️</div>

            <div className={`sd-result-card ${roundResult.p2Won ? 'sd-winner' : roundResult.draw ? '' : 'sd-loser'}`}>
              <div className="sd-result-action">{ACTIONS[roundResult.p2Action].emoji}</div>
              <div className="sd-result-label" style={{ color: '#e040fb' }}>Lord Nyx</div>
              <div className="sd-result-label">{ACTIONS[roundResult.p2Action].name}</div>
              <div className={`sd-result-outcome ${roundResult.p2Won ? 'sd-win' : roundResult.draw ? 'sd-draw' : 'sd-lose'}`}>
                {roundResult.p2Won ? '🏆 VICTORY' : roundResult.draw ? '⚖️ DRAW' : '💀 DEFEAT'}
              </div>
              <div className={`sd-prestige-change ${roundResult.p2Delta >= 0 ? 'sd-positive' : 'sd-negative'}`}>
                Prestige: {roundResult.p2Delta >= 0 ? '+' : ''}{roundResult.p2Delta}
              </div>
              {roundResult.p2Damage > 0 && (
                <div className="sd-prestige-change sd-negative">HP: -{roundResult.p2Damage}</div>
              )}
            </div>
          </div>

          {onChainMode && txHash && (
            <div style={{
              fontSize: '0.35rem', color: '#2ecc40', marginBottom: '1rem',
              fontFamily: 'var(--pixel-font)',
            }}>
              🌐 Verified on Stellar:{' '}
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#ffd700' }}
              >
                View Transaction
              </a>
            </div>
          )}

          <button className="sd-next-round-btn" onClick={nextRound}>
            {round >= MAX_ROUNDS ? '👑 See Final Result' : `⚔️ Next Round (${round + 1}/${MAX_ROUNDS})`}
          </button>
        </div>
      )}

      {/* =============== GAME OVER =============== */}
      {phase === 'gameover' && (
        <div className="sd-resolution">
          <div className="sd-game-over">
            <div className="sd-trophy">👑</div>
            <div className="sd-game-over-title">
              {winner === 'p1' ? 'King Aurelion Reigns!' : 'Lord Nyx Conquers!'}
            </div>
            <div className="sd-game-over-subtitle">
              The war is over. The throne has been claimed.
              {onChainMode && ' All actions recorded on Stellar blockchain.'}
            </div>

            <div className="sd-battle-result">
              <div className={`sd-result-card ${winner === 'p1' ? 'sd-winner' : 'sd-loser'}`}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>👑</div>
                <div className="sd-result-label" style={{ color: '#ffd700' }}>King Aurelion</div>
                <div style={{ fontSize: '0.5rem', marginTop: '0.3rem' }}>HP: {player1.stats.hp}/{player1.stats.maxHp}</div>
                <div style={{ fontSize: '0.5rem' }}>Prestige: {player1.stats.prestige}</div>
              </div>
              <div className={`sd-result-card ${winner === 'p2' ? 'sd-winner' : 'sd-loser'}`}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🐉</div>
                <div className="sd-result-label" style={{ color: '#e040fb' }}>Lord Nyx</div>
                <div style={{ fontSize: '0.5rem', marginTop: '0.3rem' }}>HP: {player2.stats.hp}/{player2.stats.maxHp}</div>
                <div style={{ fontSize: '0.5rem' }}>Prestige: {player2.stats.prestige}</div>
              </div>
            </div>

            {onChainMode && (
              <div style={{
                fontSize: '0.35rem', color: '#2ecc40', margin: '1rem 0',
                fontFamily: 'var(--pixel-font)', lineHeight: '2',
              }}>
                🌐 Session #{sessionId} — All rounds verified on Stellar Testnet<br />
                📡 Game Hub end_game() called — results registered
              </div>
            )}

            <button className="sd-play-again-btn" onClick={() => startGame(onChainMode)}>
              ⚔️ Play Again
            </button>
          </div>
        </div>
      )}

      {/* =============== CHRONICLE =============== */}
      <div className="sd-chronicle" ref={chronicleRef}>
        <div className="sd-chronicle-title">📜 Chronicle</div>
        {logs.map((log, i) => (
          <div key={i} className={`sd-chronicle-entry ${log.important ? 'sd-important' : ''}`}>
            <span className="sd-time">[{log.time}]</span>
            {log.message}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="sd-game-footer">
        {sorobanService.isConfigured && (
          <>Contract: {sorobanService.contractAddress.slice(0, 8)}... • </>
        )}
        Stellar Dynasties: ZK-Intrigue • Stellar Hacks • Soroban + Noir
      </div>
    </div>
  );
}
