//! Tests for `get_users_with_shares` indexer pagination (Issue #440).
//!
//! The vault keeps an append-only index of addresses that have ever held
//! non-zero shares. `get_users_with_shares(start, limit)` pages over that index
//! and filters out slots whose current share balance is zero (fully-withdrawn
//! holders that were never pruned). See the function's doc comment for the
//! stale-entry trade-off.

use super::utils::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_empty_index_returns_empty() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _agent, _owner, _usdc) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    assert_eq!(client.get_users_with_shares(&0, &10).len(), 0);
}

#[test]
fn test_lists_all_holders_with_shares() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _agent, _owner, usdc) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    let u1 = Address::generate(&env);
    let u2 = Address::generate(&env);
    let u3 = Address::generate(&env);
    mint_and_deposit(&env, &client, &usdc, &u1, 5_000_000);
    mint_and_deposit(&env, &client, &usdc, &u2, 3_000_000);
    mint_and_deposit(&env, &client, &usdc, &u3, 7_000_000);

    let all = client.get_users_with_shares(&0, &10);
    assert_eq!(all.len(), 3, "all three holders should be listed");
    // First deposits are 1:1, so shares equal the deposited amounts, and the
    // index preserves deposit order.
    assert_eq!(all.get(0).unwrap(), (u1, 5_000_000));
    assert_eq!(all.get(1).unwrap(), (u2, 3_000_000));
    assert_eq!(all.get(2).unwrap(), (u3, 7_000_000));
}

#[test]
fn test_pagination_start_and_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _agent, _owner, usdc) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    let u1 = Address::generate(&env);
    let u2 = Address::generate(&env);
    let u3 = Address::generate(&env);
    mint_and_deposit(&env, &client, &usdc, &u1, 5_000_000);
    mint_and_deposit(&env, &client, &usdc, &u2, 3_000_000);
    mint_and_deposit(&env, &client, &usdc, &u3, 7_000_000);

    // Page of 2 from the start.
    let page0 = client.get_users_with_shares(&0, &2);
    assert_eq!(page0.len(), 2);
    assert_eq!(page0.get(0).unwrap(), (u1, 5_000_000));
    assert_eq!(page0.get(1).unwrap(), (u2, 3_000_000));

    // Second page picks up where the first left off.
    let page1 = client.get_users_with_shares(&2, &2);
    assert_eq!(page1.len(), 1);
    assert_eq!(page1.get(0).unwrap(), (u3, 7_000_000));

    // Beyond the end returns empty.
    assert_eq!(client.get_users_with_shares(&4, &2).len(), 0);

    // limit == 0 returns empty.
    assert_eq!(client.get_users_with_shares(&0, &0).len(), 0);
}

#[test]
fn test_zero_share_holders_are_filtered_out() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _agent, _owner, usdc) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    let u1 = Address::generate(&env);
    let u2 = Address::generate(&env);
    let u3 = Address::generate(&env);
    mint_and_deposit(&env, &client, &usdc, &u1, 5_000_000);
    mint_and_deposit(&env, &client, &usdc, &u2, 3_000_000);
    mint_and_deposit(&env, &client, &usdc, &u3, 7_000_000);

    // u2 fully withdraws: shares -> 0, but the index slot stays.
    client.withdraw_all(&u2);
    assert_eq!(client.get_shares(&u2), 0);

    // The full listing omits the zero-share holder.
    let all = client.get_users_with_shares(&0, &10);
    assert_eq!(all.len(), 2, "fully-withdrawn holder must be filtered out");
    assert_eq!(all.get(0).unwrap(), (u1.clone(), 5_000_000));
    assert_eq!(all.get(1).unwrap(), (u3.clone(), 7_000_000));

    // The stale slot still occupies index position 1, so a page over just that
    // slot returns empty even though other holders exist (documented behaviour).
    assert_eq!(client.get_users_with_shares(&1, &1).len(), 0);
}

#[test]
fn test_redeposit_does_not_duplicate_index_entry() {
    let env = Env::default();
    env.mock_all_auths();
    let (contract_id, _agent, _owner, usdc) = setup_vault_with_token(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    let u1 = Address::generate(&env);
    let u2 = Address::generate(&env);
    mint_and_deposit(&env, &client, &usdc, &u1, 5_000_000);
    mint_and_deposit(&env, &client, &usdc, &u2, 3_000_000);

    // u2 fully withdraws then re-deposits.
    client.withdraw_all(&u2);
    mint_and_deposit(&env, &client, &usdc, &u2, 2_000_000);

    let all = client.get_users_with_shares(&0, &10);
    assert_eq!(all.len(), 2, "re-deposit must not create a duplicate entry");

    // Only two index slots exist: a page starting at slot 2 is empty.
    assert_eq!(client.get_users_with_shares(&2, &10).len(), 0);
}
