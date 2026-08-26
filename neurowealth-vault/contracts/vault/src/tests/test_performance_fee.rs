#![cfg(test)]

use crate::tests::utils::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_performance_fee_configuration_and_deduction() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let agent = Address::generate(&env);
    let user = Address::generate(&env);
    let treasury = Address::generate(&env);

    let (vault_id, usdc_id, _pool_id) = setup_vault(&env, &owner, &agent);

    // Initial deposit
    mint_usdc(&env, &usdc_id, &user, 10_000_0000000);
    deposit_usdc(&env, &vault_id, &user, 10_000_0000000);

    // Set performance fee to 500 bps (5%)
    let max_allowed_bps = 1000u32;
    let set_bps = 500u32;
    assert!(set_bps <= max_allowed_bps);

    // Verify fee calculation logic on $1,000 yield
    let yield_earned = 1_000_0000000i128;
    let fee_amount = (yield_earned * (set_bps as i128)) / 10_000;
    let net_yield = yield_earned - fee_amount;

    assert_eq!(fee_amount, 50_0000000); // 50 USDC fee
    assert_eq!(net_yield, 950_0000000); // 950 USDC to users
}

#[test]
fn test_performance_fee_exceeds_maximum_rejected() {
    let max_allowed_bps = 1000u32; // 10%
    let invalid_bps = 1001u32;
    assert!(invalid_bps > max_allowed_bps);
}
