import { Layout } from './components/Layout';
import { useWallet } from './hooks/useWallet';
import { StellarDynastiesGame } from './games/stellar-dynasties/StellarDynastiesGame';

const GAME_TITLE = import.meta.env.VITE_GAME_TITLE || 'Stellar Dynasties';
const GAME_TAGLINE = import.meta.env.VITE_GAME_TAGLINE || 'ZK-Intrigue on Stellar';

export default function App() {
  const { publicKey, isConnected } = useWallet();

  // Use connected wallet address or a demo address for standalone mode
  const userAddress = publicKey || 'GDEMO_PLAYER_1_ADDR_ZK_INTRIGUE';

  return (
    <Layout title={GAME_TITLE} subtitle={GAME_TAGLINE}>
      <StellarDynastiesGame
        userAddress={userAddress}
        currentEpoch={1}
        availablePoints={1000000000n}
        onStandingsRefresh={() => { }}
        onGameComplete={() => { }}
      />
    </Layout>
  );
}
