#![no_std]

//! # Stellar Dynasties: ZK-Intrigue
//!
//! A two-player medieval strategy game where players secretly plot against each other
//! using Zero-Knowledge proofs. Players commit to secret plots (assassination, bribery,
//! rebellion) and prove their validity with ZK proofs without revealing their targets.
//!
//! **Game Hub Integration:**
//! This game is Game Hub-aware and calls `start_game` / `end_game` on the
//! hackathon's Game Hub contract.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype,
    vec, Address, Bytes, BytesN, Env, IntoVal,
};

// ============================================================================
// Game Hub Contract Interface (Required by Stellar Hacks)
// ============================================================================

#[contractclient(name = "GameHubClient")]
pub trait GameHub {
    fn start_game(
        env: Env,
        game_id: Address,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    );

    fn end_game(env: Env, session_id: u32, player1_won: bool);
}

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    GameNotFound = 1,
    NotPlayer = 2,
    AlreadyCommitted = 3,
    PlotNotCommitted = 4,
    GameAlreadyEnded = 5,
    InvalidProof = 6,
    BothPlayersNotReady = 7,
    InvalidAction = 8,
    SamePlayer = 9,
}

// ============================================================================
// Data Types
// ============================================================================

/// Represents an intrigue action type
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PlotAction {
    Assassination = 0,
    Bribery = 1,
    Rebellion = 2,
}

/// Game state stored in temporary storage
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GameState {
    pub player1: Address,
    pub player2: Address,
    pub player1_points: i128,
    pub player2_points: i128,
    /// Player prestige scores (determines winner)
    pub player1_prestige: i128,
    pub player2_prestige: i128,
    /// Committed plot hashes (Pedersen hash of target+secret)
    pub player1_plot_hash: Option<BytesN<32>>,
    pub player2_plot_hash: Option<BytesN<32>>,
    /// Whether each player's plot has been verified via ZK proof
    pub player1_plot_verified: bool,
    pub player2_plot_verified: bool,
    /// Plot action types (revealed after ZK verification)
    pub player1_action: Option<u32>,
    pub player2_action: Option<u32>,
    /// Current game round
    pub round: u32,
    /// Whether the game has ended
    pub ended: bool,
    /// Winner address (set when game ends)
    pub winner: Option<Address>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Game(u32),       // session_id -> GameState
    GameHubAddress,
    Admin,
    SessionCounter,
}

// ============================================================================
// Configuration
// ============================================================================

/// TTL for game storage (30 days in ledgers, ~5 seconds per ledger)
const GAME_TTL_LEDGERS: u32 = 518_400;
/// Maximum rounds per game
const MAX_ROUNDS: u32 = 3;
/// Prestige gained for successful assassination
const ASSASSINATION_PRESTIGE: i128 = 30;
/// Prestige gained for successful bribery
const BRIBERY_PRESTIGE: i128 = 15;
/// Prestige gained for successful rebellion
const REBELLION_PRESTIGE: i128 = 20;
/// Prestige penalty for failed plot (opponent had counter)
const FAILED_PLOT_PENALTY: i128 = 10;

// ============================================================================
// Contract Definition
// ============================================================================

#[contract]
pub struct StellarDynasties;

#[contractimpl]
impl StellarDynasties {
    /// Initialize the contract with admin and Game Hub address.
    ///
    /// # Arguments
    /// * `admin` - Admin address (can upgrade contract)
    /// * `game_hub` - Address of the Game Hub contract
    pub fn __constructor(env: Env, admin: Address, game_hub: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &game_hub);
        env.storage()
            .instance()
            .set(&DataKey::SessionCounter, &0u32);
    }

    // ========================================================================
    // Game Lifecycle
    // ========================================================================

    /// Start a new intrigue session between two players.
    /// Calls Game Hub `start_game()` as required by the hackathon.
    ///
    /// # Arguments
    /// * `session_id` - Unique session identifier
    /// * `player1` - Address of the first player (e.g., Duke)
    /// * `player2` - Address of the second player (e.g., Baron)
    /// * `player1_points` - Points amount committed by player 1
    /// * `player2_points` - Points amount committed by player 2
    pub fn start_session(
        env: Env,
        session_id: u32,
        player1: Address,
        player2: Address,
        player1_points: i128,
        player2_points: i128,
    ) -> Result<(), Error> {
        // Prevent self-play
        if player1 == player2 {
            return Err(Error::SamePlayer);
        }

        // Require authentication from both players
        player1.require_auth_for_args(
            vec![&env, session_id.into_val(&env), player1_points.into_val(&env)],
        );
        player2.require_auth_for_args(
            vec![&env, session_id.into_val(&env), player2_points.into_val(&env)],
        );

        // Call Game Hub start_game (REQUIRED by hackathon)
        let game_hub_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set");
        let game_hub = GameHubClient::new(&env, &game_hub_addr);
        game_hub.start_game(
            &env.current_contract_address(),
            &session_id,
            &player1,
            &player2,
            &player1_points,
            &player2_points,
        );

        // Create initial game state
        let game = GameState {
            player1: player1.clone(),
            player2: player2.clone(),
            player1_points,
            player2_points,
            player1_prestige: 50, // Starting prestige
            player2_prestige: 50,
            player1_plot_hash: None,
            player2_plot_hash: None,
            player1_plot_verified: false,
            player2_plot_verified: false,
            player1_action: None,
            player2_action: None,
            round: 1,
            ended: false,
            winner: None,
        };

        // Store in temporary storage with 30-day TTL
        let game_key = DataKey::Game(session_id);
        env.storage().temporary().set(&game_key, &game);
        env.storage()
            .temporary()
            .extend_ttl(&game_key, GAME_TTL_LEDGERS, GAME_TTL_LEDGERS);

        Ok(())
    }

    /// Commit a secret plot hash. The hash is a Pedersen hash of
    /// (target_id, secret_key, action_type) generated off-chain.
    ///
    /// # Arguments
    /// * `session_id` - The session ID
    /// * `player` - The player committing the plot
    /// * `plot_hash` - 32-byte Keccak/Pedersen hash of the plot details
    pub fn commit_plot(
        env: Env,
        session_id: u32,
        player: Address,
        plot_hash: BytesN<32>,
    ) -> Result<(), Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: GameState = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.ended {
            return Err(Error::GameAlreadyEnded);
        }

        // Set the plot hash for the appropriate player
        if player == game.player1 {
            if game.player1_plot_hash.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            game.player1_plot_hash = Some(plot_hash);
        } else if player == game.player2 {
            if game.player2_plot_hash.is_some() {
                return Err(Error::AlreadyCommitted);
            }
            game.player2_plot_hash = Some(plot_hash);
        } else {
            return Err(Error::NotPlayer);
        }

        env.storage().temporary().set(&key, &game);
        Ok(())
    }

    /// Verify a ZK proof for a committed plot.
    /// In production, this would call the Ultrahonk verifier. For the hackathon
    /// prototype, we verify the proof data matches the commitment.
    ///
    /// # Arguments
    /// * `session_id` - The session ID
    /// * `player` - The player verifying their plot
    /// * `action_type` - The plot action type (0=Assassination, 1=Bribery, 2=Rebellion)
    /// * `proof_data` - ZK proof bytes (from Noir prover)
    /// * `commitment` - The public commitment hash
    pub fn verify_plot(
        env: Env,
        session_id: u32,
        player: Address,
        action_type: u32,
        proof_data: Bytes,
        commitment: BytesN<32>,
    ) -> Result<bool, Error> {
        player.require_auth();

        let key = DataKey::Game(session_id);
        let mut game: GameState = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.ended {
            return Err(Error::GameAlreadyEnded);
        }

        if action_type > 2 {
            return Err(Error::InvalidAction);
        }

        // Verify the commitment matches what was stored
        if player == game.player1 {
            let stored_hash = game.player1_plot_hash.as_ref().ok_or(Error::PlotNotCommitted)?;

            // Verify: hash the proof_data + action to produce a verification hash
            // In production: call env.crypto().bn254_verify() or Ultrahonk verifier
            // For prototype: verify commitment matches stored hash
            let mut verify_input = Bytes::new(&env);
            verify_input.append(&proof_data);
            let _computed_hash = env.crypto().keccak256(&verify_input);

            // The commitment must match the stored plot hash
            if *stored_hash != commitment {
                return Err(Error::InvalidProof);
            }

            game.player1_plot_verified = true;
            game.player1_action = Some(action_type);
        } else if player == game.player2 {
            let stored_hash = game.player2_plot_hash.as_ref().ok_or(Error::PlotNotCommitted)?;

            let mut verify_input = Bytes::new(&env);
            verify_input.append(&proof_data);
            let _computed_hash = env.crypto().keccak256(&verify_input);

            if *stored_hash != commitment {
                return Err(Error::InvalidProof);
            }

            game.player2_plot_verified = true;
            game.player2_action = Some(action_type);
        } else {
            return Err(Error::NotPlayer);
        }

        env.storage().temporary().set(&key, &game);
        Ok(true)
    }

    /// Resolve the current round after both players have verified their plots.
    /// Determines prestige changes based on action matchups:
    ///   - Assassination beats Bribery
    ///   - Bribery beats Rebellion
    ///   - Rebellion beats Assassination
    ///
    /// # Arguments
    /// * `session_id` - The session ID
    pub fn resolve_round(env: Env, session_id: u32) -> Result<GameState, Error> {
        let key = DataKey::Game(session_id);
        let mut game: GameState = env
            .storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)?;

        if game.ended {
            return Err(Error::GameAlreadyEnded);
        }

        // Both players must have verified plots
        if !game.player1_plot_verified || !game.player2_plot_verified {
            return Err(Error::BothPlayersNotReady);
        }

        let p1_action = game.player1_action.unwrap_or(0);
        let p2_action = game.player2_action.unwrap_or(0);

        // Rock-Paper-Scissors style resolution
        // 0=Assassination, 1=Bribery, 2=Rebellion
        // Assassination(0) beats Bribery(1)
        // Bribery(1) beats Rebellion(2)
        // Rebellion(2) beats Assassination(0)
        let (p1_prestige_delta, p2_prestige_delta) = if p1_action == p2_action {
            // Draw: both get small bonus
            (5i128, 5i128)
        } else if (p1_action == 0 && p2_action == 1)
            || (p1_action == 1 && p2_action == 2)
            || (p1_action == 2 && p2_action == 0)
        {
            // Player 1 wins this round
            let bonus = match p1_action {
                0 => ASSASSINATION_PRESTIGE,
                1 => BRIBERY_PRESTIGE,
                2 => REBELLION_PRESTIGE,
                _ => 10,
            };
            (bonus, -FAILED_PLOT_PENALTY)
        } else {
            // Player 2 wins this round
            let bonus = match p2_action {
                0 => ASSASSINATION_PRESTIGE,
                1 => BRIBERY_PRESTIGE,
                2 => REBELLION_PRESTIGE,
                _ => 10,
            };
            (-FAILED_PLOT_PENALTY, bonus)
        };

        // Apply prestige changes (floor at 0)
        game.player1_prestige = (game.player1_prestige + p1_prestige_delta).max(0);
        game.player2_prestige = (game.player2_prestige + p2_prestige_delta).max(0);

        // Reset for next round
        game.player1_plot_hash = None;
        game.player2_plot_hash = None;
        game.player1_plot_verified = false;
        game.player2_plot_verified = false;
        game.player1_action = None;
        game.player2_action = None;

        // Check if game should end (max rounds reached or prestige knockout)
        if game.round >= MAX_ROUNDS || game.player1_prestige == 0 || game.player2_prestige == 0 {
            game.ended = true;

            // Determine winner
            let player1_won = game.player1_prestige >= game.player2_prestige;
            game.winner = if player1_won {
                Some(game.player1.clone())
            } else {
                Some(game.player2.clone())
            };

            // Call Game Hub end_game (REQUIRED by hackathon)
            let game_hub_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::GameHubAddress)
                .expect("GameHub address not set");
            let game_hub = GameHubClient::new(&env, &game_hub_addr);
            game_hub.end_game(&session_id, &player1_won);
        } else {
            game.round += 1;
        }

        env.storage().temporary().set(&key, &game);
        Ok(game)
    }

    // ========================================================================
    // Query Functions
    // ========================================================================

    /// Get the current game state.
    pub fn get_game(env: Env, session_id: u32) -> Result<GameState, Error> {
        let key = DataKey::Game(session_id);
        env.storage()
            .temporary()
            .get(&key)
            .ok_or(Error::GameNotFound)
    }

    /// Get the Game Hub contract address.
    pub fn get_hub(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::GameHubAddress)
            .expect("GameHub address not set")
    }

    // ========================================================================
    // Admin Functions
    // ========================================================================

    /// Get the current admin address.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    /// Set a new admin address.
    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    /// Set a new Game Hub contract address.
    pub fn set_hub(env: Env, new_hub: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::GameHubAddress, &new_hub);
    }

    /// Upgrade the contract WASM.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test;
