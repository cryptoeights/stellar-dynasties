// Stellar Dynasties: ZK-Intrigue -- Secret Plot Circuit
//
// This circuit proves that a player knows a valid (target_id, secret_key, action_type)
// triple that hashes to a given public commitment -- WITHOUT revealing target or secret.
//
// Private inputs: target_id, secret_key, action_type
// Public inputs: action_commitment (the hash the contract stores)
//
// Verification: pedersen_hash(target_id, secret_key, action_type) == action_commitment

use std::hash::pedersen_hash;

fn main(
    // Private inputs (known only to the prover / player)
    target_id: Field,       // Who you're plotting against (secret)
    secret_key: Field,      // Your unique secret key (secret)
    action_type: Field,     // 0=Assassination, 1=Bribery, 2=Rebellion (secret)
    
    // Public inputs (visible on-chain, used for verification)
    action_commitment: pub Field   // hash(target_id, secret_key, action_type)
) {
    // Constraint 1: action_type must be valid (0, 1, or 2)
    assert(
        (action_type == 0) | (action_type == 1) | (action_type == 2),
        "Invalid action type: must be 0 (Assassination), 1 (Bribery), or 2 (Rebellion)"
    );

    // Constraint 2: target_id must be non-zero (can't target nobody)
    assert(target_id != 0, "Target ID cannot be zero");

    // Constraint 3: secret_key must be non-zero
    assert(secret_key != 0, "Secret key cannot be zero");

    // Constraint 4: The commitment must match the hash of private inputs
    // This is the core ZK constraint -- proves knowledge without revelation
    let computed_commitment = pedersen_hash([target_id, secret_key, action_type]);
    assert(
        computed_commitment == action_commitment,
        "Commitment does not match: invalid proof"
    );
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_valid_assassination_plot() {
    let target = 42;        // Secret target
    let secret = 12345;     // Secret key
    let action = 0;         // Assassination

    let commitment = pedersen_hash([target, secret, action]);
    main(target, secret, action, commitment);
}

#[test]
fn test_valid_bribery_plot() {
    let target = 7;
    let secret = 99999;
    let action = 1;         // Bribery

    let commitment = pedersen_hash([target, secret, action]);
    main(target, secret, action, commitment);
}

#[test]
fn test_valid_rebellion_plot() {
    let target = 100;
    let secret = 55555;
    let action = 2;         // Rebellion

    let commitment = pedersen_hash([target, secret, action]);
    main(target, secret, action, commitment);
}

#[test(should_fail_with = "Commitment does not match")]
fn test_wrong_commitment_fails() {
    let target = 42;
    let secret = 12345;
    let action = 0;

    // Use wrong commitment
    let wrong_commitment = pedersen_hash([target, secret, 1]); // wrong action
    main(target, secret, action, wrong_commitment);
}

#[test(should_fail_with = "Invalid action type")]
fn test_invalid_action_fails() {
    let target = 42;
    let secret = 12345;
    let action = 5;         // Invalid!

    let commitment = pedersen_hash([target, secret, action]);
    main(target, secret, action, commitment);
}

#[test(should_fail_with = "Target ID cannot be zero")]
fn test_zero_target_fails() {
    let target = 0;         // Invalid!
    let secret = 12345;
    let action = 0;

    let commitment = pedersen_hash([target, secret, action]);
    main(target, secret, action, commitment);
}
