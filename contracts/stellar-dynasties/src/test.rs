#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env};

fn setup_env() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    // Register mock game hub
    let game_hub_id = env.register(crate::test_mock_hub::MockGameHub, ());
    // Register our contract with constructor args
    let contract_id = env.register(
        StellarDynasties,
        (
            &Address::generate(&env), // admin
            &game_hub_id,             // game_hub
        ),
    );

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    (env, contract_id, game_hub_id, player1, player2)
}

#[test]
fn test_start_session() {
    let (env, contract_id, _, player1, player2) = setup_env();
    let client = StellarDynastiesClient::new(&env, &contract_id);

    client.start_session(&1u32, &player1, &player2, &1000i128, &1000i128);

    let game = client.get_game(&1u32);
    assert_eq!(game.player1, player1);
    assert_eq!(game.player2, player2);
    assert_eq!(game.player1_prestige, 50);
    assert_eq!(game.player2_prestige, 50);
    assert_eq!(game.round, 1);
    assert!(!game.ended);
}

#[test]
fn test_commit_plot() {
    let (env, contract_id, _, player1, player2) = setup_env();
    let client = StellarDynastiesClient::new(&env, &contract_id);

    client.start_session(&1u32, &player1, &player2, &1000i128, &1000i128);

    // Create a plot hash
    let plot_hash = BytesN::from_array(&env, &[1u8; 32]);
    client.commit_plot(&1u32, &player1, &plot_hash);

    let game = client.get_game(&1u32);
    assert!(game.player1_plot_hash.is_some());
    assert!(game.player2_plot_hash.is_none());
}

#[test]
fn test_full_round() {
    let (env, contract_id, _, player1, player2) = setup_env();
    let client = StellarDynastiesClient::new(&env, &contract_id);

    client.start_session(&1u32, &player1, &player2, &1000i128, &1000i128);

    // Both players commit plots
    let hash1 = BytesN::from_array(&env, &[1u8; 32]);
    let hash2 = BytesN::from_array(&env, &[2u8; 32]);
    client.commit_plot(&1u32, &player1, &hash1);
    client.commit_plot(&1u32, &player2, &hash2);

    // Both players verify plots (action 0 = assassination, action 1 = bribery)
    let proof1 = Bytes::from_array(&env, &[10u8; 64]);
    let proof2 = Bytes::from_array(&env, &[20u8; 64]);
    client.verify_plot(&1u32, &player1, &0u32, &proof1, &hash1);
    client.verify_plot(&1u32, &player2, &1u32, &proof2, &hash2);

    // Resolve round: Assassination(0) beats Bribery(1) => player1 wins
    let game = client.resolve_round(&1u32);
    assert_eq!(game.round, 2); // Advanced to round 2
    assert!(game.player1_prestige > 50); // Player1 gained prestige
    assert!(game.player2_prestige < 50); // Player2 lost prestige
}

// Minimal mock for testing
mod test_mock_hub {
    use soroban_sdk::{contract, contractimpl, Address, Env};

    #[contract]
    pub struct MockGameHub;

    #[contractimpl]
    impl MockGameHub {
        pub fn start_game(
            _env: Env,
            _game_id: Address,
            _session_id: u32,
            _player1: Address,
            _player2: Address,
            _player1_points: i128,
            _player2_points: i128,
        ) {
        }

        pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {}
    }
}
