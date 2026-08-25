//! Tests for deposit functionality

use super::utils::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_deposit_minimum_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let amount = 1_000_000_i128; // Minimum deposit (1 USDC)

    mint_and_deposit(&env, &client, &usdc_token, &user, amount);

    assert_eq!(client.get_shares(&user), amount);
    assert_eq!(client.get_total_deposits(), amount);
    assert_eq!(client.get_total_assets(), amount);
}

#[test]
fn test_deposit_maximum_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let amount = 10_000_000_000_i128; // Maximum deposit (10K USDC = UserDepositCap default)

    mint_and_deposit(&env, &client, &usdc_token, &user, amount);

    assert_eq!(client.get_shares(&user), amount);
    assert_eq!(client.get_total_deposits(), amount);
}

#[test]
#[should_panic(expected = "Error(Contract, #37)")]
fn test_deposit_zero_assets_rejected() {
    // A zero-asset deposit must be rejected early with AmountMustBePositive (#37),
    // before any token transfer or storage write occurs. Zero-value deposits would
    // otherwise consume ledger resources without changing vault state (Issue #537).
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);
    let token_client = TestTokenClient::new(&env, &usdc_token);

    let user = Address::generate(&env);

    // Fund the user with some USDC so the rejection is clearly about the zero
    // amount, not an insufficient balance.
    token_client.mint(&user, &10_000_000_i128);
    client.deposit(&user, &0_0000000_i128);
}

#[test]
#[should_panic(expected = "Error(Contract, #37)")]
fn test_deposit_zero_after_approving_zero_rejected() {
    // Edge case: explicitly approve zero tokens, then deposit zero. The positive-amount
    // guard fires before the token transfer, so the allowance value is irrelevant (#537).
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);
    let token_client = TestTokenClient::new(&env, &usdc_token);

    let user = Address::generate(&env);

    token_client.mint(&user, &10_000_000_i128);
    token_client.approve(&user, &contract_id, &0_i128, &u32::MAX);
    client.deposit(&user, &0_0000000_i128);
}

#[test]
#[should_panic(expected = "Error(Contract, #37)")]
fn test_deposit_zero_with_no_allowance_rejected() {
    // Edge case: deposit zero with no allowance set at all. The vault still rejects
    // on the positive-amount guard before touching the token contract (#537).
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    let user = Address::generate(&env);

    // No mint, no approve — nothing but a zero-amount deposit.
    client.deposit(&user, &0_0000000_i128);
}

#[test]
#[should_panic(expected = "Error(Contract, #38)")]
fn test_deposit_below_minimum_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);
    let token_client = TestTokenClient::new(&env, &usdc_token);

    let user = Address::generate(&env);
    let amount = 999_999_i128; // Below minimum

    token_client.mint(&user, &amount);
    client.deposit(&user, &amount);
}

#[test]
#[should_panic(expected = "Error(Contract, #39)")]
fn test_deposit_above_maximum_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);
    let token_client = TestTokenClient::new(&env, &usdc_token);

    // Set a lower max for testing
    let min = 1_000_000_i128;
    let max = 5_000_000_i128;
    client.set_deposit_limits(&min, &max);

    let user = Address::generate(&env);
    let amount = 6_000_000_i128; // Above maximum

    token_client.mint(&user, &amount);
    client.deposit(&user, &amount);
}

#[test]
#[should_panic(expected = "Error(Contract, #35)")]
fn test_deposit_while_paused_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);
    let token_client = TestTokenClient::new(&env, &usdc_token);

    // Pause the vault
    client.pause(&owner);
    assert!(client.is_paused());

    let user = Address::generate(&env);
    let amount = 5_000_000_i128;

    token_client.mint(&user, &amount);
    client.deposit(&user, &amount);
}

#[test]
fn test_deposit_shares_updated_correctly() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let amount = 5_000_000_i128;

    mint_and_deposit(&env, &client, &usdc_token, &user, amount);

    // First deposit should mint 1:1 shares
    assert_eq!(client.get_shares(&user), amount);
}

#[test]
fn test_deposit_total_assets_updated_correctly() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let amount = 5_000_000_i128;

    mint_and_deposit(&env, &client, &usdc_token, &user, amount);

    assert_eq!(client.get_total_assets(), amount);
    assert_eq!(client.get_total_deposits(), amount);
}

#[test]
fn test_multiple_deposits_accumulate_correctly() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let amount1 = 5_000_000_i128;
    let amount2 = 3_000_000_i128;

    mint_and_deposit(&env, &client, &usdc_token, &user, amount1);
    mint_and_deposit(&env, &client, &usdc_token, &user, amount2);

    assert_eq!(client.get_total_deposits(), amount1 + amount2);
    assert_eq!(client.get_shares(&user), amount1 + amount2);
}

#[test]
fn test_multiple_users_tracked_independently() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let amount1 = 5_000_000_i128;
    let amount2 = 3_000_000_i128;

    mint_and_deposit(&env, &client, &usdc_token, &user1, amount1);
    mint_and_deposit(&env, &client, &usdc_token, &user2, amount2);

    assert_eq!(client.get_shares(&user1), amount1);
    assert_eq!(client.get_shares(&user2), amount2);
    assert_eq!(client.get_total_deposits(), amount1 + amount2);
    assert_eq!(client.get_total_assets(), amount1 + amount2);
}

#[test]
fn test_deposit_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let amount = 5_000_000_i128;

    mint_and_deposit(&env, &client, &usdc_token, &user, amount);

    let deposit_events = find_events_by_topic(
        env.events().all(),
        &env,
        soroban_sdk::symbol_short!("deposit"),
    );
    assert!(!deposit_events.is_empty(), "Deposit should emit an event");
}
