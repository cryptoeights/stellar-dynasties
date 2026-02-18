# ⚔️ Stellar Dynasties: ZK-Intrigue

> A **Dokapon Kingdom-inspired medieval strategy game** built on Stellar, powered by **Zero-Knowledge proofs** for secret plot commitments.

**Stellar Hacks 2025 — ZK Gaming Track**

![Game UI](stellar-dynasties-frontend/public/characters/king_golden.png)

---

## 🎮 Game Overview

Two rival kings — **King Aurelion (The Golden Lion)** and **Lord Nyx (The Dark Dragon)** — wage a 3-round war for the throne. Each round, players secretly choose a plot action and seal it with a **Zero-Knowledge proof** before revealing.

### Battle Mechanics (Rock-Paper-Scissors)

| Action | Beats | Description |
|--------|-------|-------------|
| 🗡️ **Assassination** | 💰 Bribery | Strike from the shadows |
| 💰 **Bribery** | ⚔️ Rebellion | Buy their loyalty |
| ⚔️ **Rebellion** | 🗡️ Assassination | Overthrow the crown |

### Game Flow

1. **Lobby** — Two kings face off on the battlefield
2. **Plot Phase** — Choose your secret action (Assassination / Bribery / Rebellion)
3. **ZK Proof Generation** — Your choice is sealed with a Pedersen hash commitment
4. **Battle Resolution** — Actions are revealed, winner gains prestige, loser takes damage
5. **Game Over** — After 3 rounds, the king with the most prestige wins the throne

---

## 🔐 ZK-Powered Mechanic

The core mechanic uses **Noir** (Aztec's ZK-SNARK language) with **BN254** elliptic curve proofs:

```
// Noir Circuit: Pedersen Hash Commitment
fn main(
    target: Field,      // Who you're targeting
    secret: Field,      // Your secret nonce
    action_type: Field, // 0=Assassinate, 1=Bribe, 2=Rebel
    commitment: pub Field  // Public commitment hash
) {
    let hash = std::hash::pedersen_hash([target, secret, action_type]);
    assert(hash == commitment);  // Prove knowledge without revealing action
}
```

**How it works:**
1. Player selects a plot action (e.g., Assassination)
2. Frontend generates a **Pedersen hash** commitment: `hash(target, secret, action)`
3. Commitment is stored on-chain via `commit_plot()`
4. Player generates a **ZK proof** proving they know the preimage
5. Proof is verified on-chain via `verify_plot()` — action is revealed without exposing the secret

This ensures **no player can change their action after committing**, creating a fair fog-of-war mechanic.

### Circuit Tests
```
✅ 6/6 Noir tests passing:
  - test_valid_assassination
  - test_valid_bribery
  - test_valid_rebellion
  - test_invalid_hash (should fail)
  - test_boundary_values
  - test_different_secrets_different_hashes
```

---

## 🌐 Deployed On-Chain Component

| Contract | Address |
|----------|---------|
| **Stellar Dynasties** | `CC6RNEV6CK6HYXUC5J7L6QNXONPBH3GIFBS7LZMOYGLJC2JGAAKVUDMJ` |
| **Game Hub** | `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` |

**Network:** Stellar Testnet

### Game Hub Integration
The contract calls `start_game()` and `end_game()` on the hackathon's Game Hub contract:

```rust
// Start session → calls Game Hub
let game_hub = GameHubClient::new(&env, &game_hub_addr);
game_hub.start_game(
    &env.current_contract_address(),
    &session_id,
    &player1, &player2,
    &player1_points, &player2_points,
);

// End game → calls Game Hub
game_hub.end_game(&session_id, &player1_won);
```

### Smart Contract Functions (11 exported)
- `__constructor` — Initialize with admin + Game Hub address
- `start_session` — Start a new game (calls Game Hub `start_game`)
- `commit_plot` — Submit ZK commitment hash
- `verify_plot` — Verify ZK proof and reveal action
- `resolve_round` — Determine round winner (calls Game Hub `end_game`)
- `get_game` / `get_admin` / `get_hub` — View functions
- `set_admin` / `set_hub` / `upgrade` — Admin functions

---

## 🏗️ Architecture

```
stellar-dynasties/
├── circuits/                    # Noir ZK circuit
│   ├── src/main.nr             # Pedersen hash commitment proof
│   └── Nargo.toml
├── contracts/
│   ├── stellar-dynasties/      # Soroban smart contract
│   │   └── src/lib.rs          # Game logic + Game Hub integration
│   └── mock-game-hub/          # Local Game Hub mock for testing
├── stellar-dynasties-frontend/ # React + Vite frontend
│   ├── src/
│   │   ├── games/stellar-dynasties/
│   │   │   ├── StellarDynastiesGame.tsx  # Main game component
│   │   │   └── StellarDynastiesGame.css  # Battle UI styles
│   │   ├── App.tsx
│   │   └── hooks/useWallet.ts
│   └── public/characters/      # Pixel art king sprites
├── scripts/
│   ├── deploy.ts               # Testnet deployment
│   └── build.ts                # Contract build
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh/) (v1.0+)
- [Rust](https://rustup.rs/) + `wasm32v1-none` target
- [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli)
- [Nargo](https://noir-lang.org/) (Noir compiler)

### Setup & Run

```bash
# 1. Clone the repo
git clone https://github.com/cryptoeights/stellar-dynasties.git
cd stellar-dynasties

# 2. Install dependencies
bun install

# 3. Build contracts
bun run build stellar-dynasties

# 4. Deploy to testnet (generates .env with keys)
bun run deploy stellar-dynasties

# 5. Start the frontend
cd stellar-dynasties-frontend
bun install
bun run dev
# → Opens at http://localhost:3000
```

### Run ZK Circuit Tests
```bash
cd circuits
nargo test
# ✅ 6/6 tests pass
```

---

## 🎨 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Smart Contract** | Rust + Soroban SDK v25 |
| **ZK Proofs** | Noir + BN254 Pedersen Hash |
| **Frontend** | React 18 + TypeScript + Vite |
| **Blockchain** | Stellar Testnet + Soroban |
| **Styling** | Custom CSS with pixel art theme |
| **Characters** | AI-generated pixel art sprites |

---

## 📄 License

MIT

---

Built with ⚔️ for **Stellar Hacks 2025**
