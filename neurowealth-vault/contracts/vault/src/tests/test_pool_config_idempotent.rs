//! Tests for idempotent `set_blend_pool` / `set_dex_pool` (Issue #438).
//!
//! Re-configuring a protocol pool to the address it already holds must be a
//! silent no-op: no storage write and, crucially, no
//! `BlendPoolConfiguredEvent` / `DexPoolConfiguredEvent`. Changing the address
//! must still emit the event exactly once.

use super::utils::*;
use crate::{TOPIC_BLEND_POOL_CONFIGURED, TOPIC_DEX_POOL_CONFIGURED};
use soroban_sdk::Env;

#[test]
fn test_set_blend_pool_same_address_emits_no_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, owner, _usdc, blend_pool) = setup_vault_with_token_and_blend(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    // First configuration emits exactly one event.
    client.set_blend_pool(&owner, &blend_pool);
    let after_first =
        find_events_by_topic(env.events().all(), &env, TOPIC_BLEND_POOL_CONFIGURED).len();
    assert_eq!(after_first, 1, "first set_blend_pool must emit one event");
    assert_eq!(client.get_blend_pool(), Some(blend_pool.clone()));

    // Re-setting to the SAME address is an idempotent no-op — no new event.
    client.set_blend_pool(&owner, &blend_pool);
    let after_same =
        find_events_by_topic(env.events().all(), &env, TOPIC_BLEND_POOL_CONFIGURED).len();
    assert_eq!(
        after_same, 1,
        "re-setting the same Blend pool must not emit an event"
    );
    assert_eq!(
        client.get_blend_pool(),
        Some(blend_pool),
        "stored pool must be unchanged after idempotent set"
    );
}

#[test]
fn test_set_blend_pool_different_address_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, owner, _usdc, blend_pool) = setup_vault_with_token_and_blend(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    client.set_blend_pool(&owner, &blend_pool);

    // Changing to a genuinely different pool must emit again.
    let new_pool = env.register_contract(None, MockBlendPool);
    client.set_blend_pool(&owner, &new_pool);

    let count = find_events_by_topic(env.events().all(), &env, TOPIC_BLEND_POOL_CONFIGURED).len();
    assert_eq!(
        count, 2,
        "configuring a different Blend pool must emit a second event"
    );
    assert_eq!(client.get_blend_pool(), Some(new_pool));
}

#[test]
fn test_set_dex_pool_same_address_emits_no_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, owner, _usdc, dex_pool) = setup_vault_with_token_and_dex(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    client.set_dex_pool(&owner, &dex_pool);
    let after_first =
        find_events_by_topic(env.events().all(), &env, TOPIC_DEX_POOL_CONFIGURED).len();
    assert_eq!(after_first, 1, "first set_dex_pool must emit one event");
    assert_eq!(client.get_dex_pool(), Some(dex_pool.clone()));

    // Re-setting to the SAME address is an idempotent no-op — no new event.
    client.set_dex_pool(&owner, &dex_pool);
    let after_same =
        find_events_by_topic(env.events().all(), &env, TOPIC_DEX_POOL_CONFIGURED).len();
    assert_eq!(
        after_same, 1,
        "re-setting the same DEX pool must not emit an event"
    );
    assert_eq!(
        client.get_dex_pool(),
        Some(dex_pool),
        "stored pool must be unchanged after idempotent set"
    );
}

#[test]
fn test_set_dex_pool_different_address_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, _agent, owner, _usdc, dex_pool) = setup_vault_with_token_and_dex(&env);
    let client = NeuroWealthVaultClient::new(&env, &contract_id);

    client.set_dex_pool(&owner, &dex_pool);

    let new_pool = env.register_contract(None, MockDexPool);
    client.set_dex_pool(&owner, &new_pool);

    let count = find_events_by_topic(env.events().all(), &env, TOPIC_DEX_POOL_CONFIGURED).len();
    assert_eq!(
        count, 2,
        "configuring a different DEX pool must emit a second event"
    );
    assert_eq!(client.get_dex_pool(), Some(new_pool));
}
