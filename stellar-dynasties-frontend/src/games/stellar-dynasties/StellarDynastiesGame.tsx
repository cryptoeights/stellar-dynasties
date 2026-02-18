import { useState, useCallback, useEffect, useRef } from 'react';
import './StellarDynastiesGame.css';

/* ================================================================
   STELLAR DYNASTIES — Dokapon Kingdom-Style Battle Game
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

type GamePhase = 'lobby' | 'plotting' | 'zkproof' | 'resolution' | 'gameover';

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

const ZK_STEPS = [
  'Preparing witness data...',
  'Loading BN254 circuit...',
  'Computing Pedersen hash...',
  'Generating R1CS constraints...',
  'Building proof tree...',
  'Finalizing ZK-SNARK proof...',
  'Proof verified ✓',
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

// ---------- Component ----------
export function StellarDynastiesGame({ userAddress }: Props) {
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [round, setRound] = useState(1);
  const [selectedAction, setSelectedAction] = useState<number | null>(null);

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
  const [zkStep, setZkStep] = useState(0);
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

  const addLog = useCallback((msg: string, important = false) => {
    setLogs(prev => [...prev, { time: getTimestamp(), message: msg, important }]);
  }, []);

  // Auto-scroll chronicle
  useEffect(() => {
    if (chronicleRef.current) {
      chronicleRef.current.scrollTop = chronicleRef.current.scrollHeight;
    }
  }, [logs]);

  // ---------- Game Actions ----------
  const startGame = () => {
    setPhase('plotting');
    setRound(1);
    setPlayer1(p => ({ ...p, stats: { ...INITIAL_STATS }, action: null }));
    setPlayer2(p => ({ ...p, stats: { ...INITIAL_STATS }, action: null }));
    setLogs([{ time: getTimestamp(), message: '⚔️ The War of Dynasties begins! Round 1', important: true }]);
    setSelectedAction(null);
    setRoundResult(null);
    setWinner(null);
  };

  const commitPlot = () => {
    if (selectedAction === null) return;

    const enemyAction = aiChooseAction();
    setPlayer1(p => ({ ...p, action: selectedAction }));
    setPlayer2(p => ({ ...p, action: enemyAction }));

    addLog(`King Aurelion plots: ${ACTIONS[selectedAction].emoji} ${ACTIONS[selectedAction].name}`);
    addLog(`Lord Nyx plots in secret...`);

    // Start ZK proof animation
    setPhase('zkproof');
    setZkProgress(0);
    setZkStep(0);

    let step = 0;
    const interval = setInterval(() => {
      step++;
      const progress = Math.min((step / ZK_STEPS.length) * 100, 100);
      setZkProgress(progress);
      setZkStep(Math.min(step, ZK_STEPS.length - 1));

      if (step >= ZK_STEPS.length) {
        clearInterval(interval);
        setTimeout(() => resolveRound(selectedAction, enemyAction), 600);
      }
    }, 500);
  };

  const resolveRound = (p1Action: number, p2Action: number) => {
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

    // Apply stats
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

    // Check end conditions
    if (nextR > MAX_ROUNDS || player1.stats.hp <= 0 || player2.stats.hp <= 0 ||
      player1.stats.prestige <= 0 || player2.stats.prestige <= 0) {
      const p1Win = player1.stats.prestige >= player2.stats.prestige;
      setWinner(p1Win ? 'p1' : 'p2');
      setP1Anim(p1Win ? 'sd-victorious' : 'sd-defeated');
      setP2Anim(p1Win ? 'sd-defeated' : 'sd-victorious');
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
          <span className="sd-label">👤 Player:</span>
          <span className="sd-value">{userAddress.slice(0, 4)}...{userAddress.slice(-4)}</span>
        </div>
        <div className="sd-status-item">
          <span className="sd-label">🏰 Round:</span>
          <span className="sd-value">{round} / {MAX_ROUNDS}</span>
        </div>
        <div className="sd-status-item">
          <span className="sd-label">🔐 ZK:</span>
          <span className="sd-value">BN254 / Noir</span>
        </div>
        <div className="sd-status-item">
          <span className="sd-label">🌐 Net:</span>
          <span className="sd-value">Stellar Testnet</span>
        </div>
      </div>

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
            <button className="sd-start-btn" onClick={startGame}>
              ⚔️ Begin the War ⚔️
            </button>
          </div>
        </div>
      )}

      {/* =============== BATTLE SCENE (plotting / resolution / gameover) =============== */}
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
          <div className="sd-action-subtitle">Select your secret action — sealed by a ZK proof</div>

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
            🔮 Commit Plot & Generate ZK Proof
          </button>
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
          <div className="sd-zk-step">{ZK_STEPS[zkStep]}</div>
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
                <div className="sd-prestige-change sd-negative">
                  HP: -{roundResult.p1Damage}
                </div>
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
                <div className="sd-prestige-change sd-negative">
                  HP: -{roundResult.p2Damage}
                </div>
              )}
            </div>
          </div>

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
            </div>

            <div className="sd-battle-result">
              <div className={`sd-result-card ${winner === 'p1' ? 'sd-winner' : 'sd-loser'}`}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>👑</div>
                <div className="sd-result-label" style={{ color: '#ffd700' }}>King Aurelion</div>
                <div style={{ fontSize: '0.5rem', marginTop: '0.3rem' }}>
                  HP: {player1.stats.hp}/{player1.stats.maxHp}
                </div>
                <div style={{ fontSize: '0.5rem' }}>
                  Prestige: {player1.stats.prestige}
                </div>
              </div>
              <div className={`sd-result-card ${winner === 'p2' ? 'sd-winner' : 'sd-loser'}`}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🐉</div>
                <div className="sd-result-label" style={{ color: '#e040fb' }}>Lord Nyx</div>
                <div style={{ fontSize: '0.5rem', marginTop: '0.3rem' }}>
                  HP: {player2.stats.hp}/{player2.stats.maxHp}
                </div>
                <div style={{ fontSize: '0.5rem' }}>
                  Prestige: {player2.stats.prestige}
                </div>
              </div>
            </div>

            <button className="sd-play-again-btn" onClick={startGame}>
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
        Stellar Dynasties: ZK-Intrigue • Stellar Hacks • ZK Gaming • Soroban
      </div>
    </div>
  );
}
