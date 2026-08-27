#![cfg(test)]
//! Liquidity-mining reward compounding tests.
//!
//! Rewards earned on an external venue arrive as extra USDC in the vault. The
//! agent then reports the new total via `update_total_assets`, which raises the
//! share price for every holder without minting new shares.

use super::utils::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_liquidity_mining_rewards_claim_and_compound() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, agent, _owner, usdc_token) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);
    let token_client = TestTokenClient::new(&env, &usdc_token);

    let user = Address::generate(&env);
    let deposit_amount = 1_000_0000000_i128;
    mint_and_deposit(&env, &client, &usdc_token, &user, deposit_amount);
    assert_eq!(client.get_total_assets(), deposit_amount);

    let shares_before = client.get_shares(&user);

    // Simulate a claimed reward being swapped into USDC and landing in the vault.
    let reward = 500_0000000_i128;
    token_client.mint(&contract_id, &reward);

    // Agent reports the compounded total.
    let new_total = deposit_amount + reward;
    client.update_total_assets(&agent, &new_total, &false, &0u32);

    assert_eq!(client.get_total_assets(), new_total);
    // Compounding must not mint shares — it raises the share price instead.
    assert_eq!(client.get_shares(&user), shares_before);
    assert_eq!(client.convert_to_assets(&shares_before), new_total);
}
