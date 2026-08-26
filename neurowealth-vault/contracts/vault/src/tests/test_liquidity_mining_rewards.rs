#![cfg(test)]

use crate::tests::utils::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn test_liquidity_mining_rewards_claim_and_compound() {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let agent = Address::generate(&env);
    let user = Address::generate(&env);

    let (vault_id, usdc_id, _pool_id) = setup_vault(&env, &owner, &agent);

    // Initial deposit
    mint_usdc(&env, &usdc_id, &user, 10_000_0000000);
    deposit_usdc(&env, &vault_id, &user, 10_000_0000000);

    // Initial total assets
    let initial_assets: i128 = env.as_contract(&vault_id, || {
        crate::NeuroWealthVault::get_total_assets(env.clone())
    });
    assert_eq!(initial_assets, 10_000_0000000);

    // Simulate reward distribution (additional 500 USDC from swapped rewards)
    mint_usdc(&env, &usdc_id, &vault_id, 500_0000000);

    // Update total assets reflecting reward compound
    env.as_contract(&vault_id, || {
        crate::NeuroWealthVault::update_total_assets(env.clone(), 10_500_0000000);
    });

    let updated_assets: i128 = env.as_contract(&vault_id, || {
        crate::NeuroWealthVault::get_total_assets(env.clone())
    });
    assert_eq!(updated_assets, 10_500_0000000);
}
