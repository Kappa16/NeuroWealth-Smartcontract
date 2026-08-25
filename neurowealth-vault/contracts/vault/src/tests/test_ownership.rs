use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, AccountId};

use crate::Contract;

fn get_context(predecessor: AccountId) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder.predecessor_account_id(predecessor);
    builder
}

/// Helper: deploy contract with owner = accounts(0)
fn setup() -> Contract {
    let context = get_context(accounts(0));
    testing_env!(context.build());
    Contract::new(accounts(0))
}

// ──────────────────────────────────────────────
// Happy path: propose → accept
// ──────────────────────────────────────────────

#[test]
fn test_transfer_ownership_happy_path() {
    let mut contract = setup();

    // Owner proposes transfer to accounts(1)
    let ctx = get_context(accounts(0));
    testing_env!(ctx.build());
    contract.transfer_ownership(accounts(1));

    assert_eq!(
        contract.pending_owner(),
        Some(accounts(1)),
        "pending_owner should be set after transfer_ownership"
    );

    // New owner accepts
    let ctx = get_context(accounts(1));
    testing_env!(ctx.build());
    contract.accept_ownership();

    assert_eq!(
        contract.owner(),
        accounts(1),
        "owner should be updated after accept_ownership"
    );
    assert_eq!(
        contract.pending_owner(),
        None,
        "pending_owner should be cleared after accept"
    );
}

// ──────────────────────────────────────────────
// Cancel path: propose → cancel → pending cleared
// ──────────────────────────────────────────────

#[test]
fn test_cancel_ownership_transfer() {
    let mut contract = setup();

    let ctx = get_context(accounts(0));
    testing_env!(ctx.build());
    contract.transfer_ownership(accounts(1));

    assert_eq!(contract.pending_owner(), Some(accounts(1)));

    // Owner cancels
    contract.cancel_ownership_transfer();

    assert_eq!(
        contract.pending_owner(),
        None,
        "pending_owner should be None after cancel"
    );
    assert_eq!(
        contract.owner(),
        accounts(0),
        "owner should remain unchanged after cancel"
    );
}

// ──────────────────────────────────────────────
// Non-pending accept must panic
// ──────────────────────────────────────────────

#[test]
#[should_panic(expected = "No pending ownership transfer")]
fn test_accept_ownership_with_no_pending_panics() {
    let mut contract = setup();

    // accounts(1) tries to accept when nothing was proposed
    let ctx = get_context(accounts(1));
    testing_env!(ctx.build());
    contract.accept_ownership();
}

// ──────────────────────────────────────────────
// Wrong account trying to accept must panic
// ──────────────────────────────────────────────

#[test]
#[should_panic(expected = "Only pending owner can accept")]
fn test_accept_ownership_wrong_caller_panics() {
    let mut contract = setup();

    let ctx = get_context(accounts(0));
    testing_env!(ctx.build());
    contract.transfer_ownership(accounts(1));

    // accounts(2) tries to accept — should panic
    let ctx = get_context(accounts(2));
    testing_env!(ctx.build());
    contract.accept_ownership();
}

// ──────────────────────────────────────────────
// Only owner can initiate a transfer
// ──────────────────────────────────────────────

#[test]
#[should_panic(expected = "Only owner")]
fn test_transfer_ownership_non_owner_panics() {
    let mut contract = setup();

    let ctx = get_context(accounts(1)); // not the owner
    testing_env!(ctx.build());
    contract.transfer_ownership(accounts(2));
}

// ──────────────────────────────────────────────
// Only owner can cancel
// ──────────────────────────────────────────────

#[test]
#[should_panic(expected = "Only owner")]
fn test_cancel_ownership_non_owner_panics() {
    let mut contract = setup();

    let ctx = get_context(accounts(0));
    testing_env!(ctx.build());
    contract.transfer_ownership(accounts(1));

    // accounts(2) tries to cancel
    let ctx = get_context(accounts(2));
    testing_env!(ctx.build());
    contract.cancel_ownership_transfer();
}

// ──────────────────────────────────────────────
// Pending owner cannot cancel transfer (Issue #573)
// ──────────────────────────────────────────────

#[test]
#[should_panic(expected = "Only owner")]
fn test_pending_owner_cannot_cancel_ownership_transfer() {
    let mut contract = setup();

    let ctx = get_context(accounts(0));
    testing_env!(ctx.build());
    contract.transfer_ownership(accounts(1));

    assert_eq!(contract.pending_owner(), Some(accounts(1)));

    // The pending owner (accounts(1)) tries to cancel — should panic
    let ctx = get_context(accounts(1));
    testing_env!(ctx.build());
    contract.cancel_ownership_transfer();
}

#[test]
#[should_panic(expected = "Only owner")]
fn test_third_party_cannot_cancel_ownership_transfer() {
    let mut contract = setup();

    let ctx = get_context(accounts(0));
    testing_env!(ctx.build());
    contract.transfer_ownership(accounts(1));

    assert_eq!(contract.pending_owner(), Some(accounts(1)));

    // An uninvolved third party (accounts(2)) tries to cancel — should panic
    let ctx = get_context(accounts(2));
    testing_env!(ctx.build());
    contract.cancel_ownership_transfer();
}

// ──────────────────────────────────────────────
// Events emitted on transfer / accept / cancel
// ──────────────────────────────────────────────

#[test]
fn test_transfer_ownership_emits_event() {
    let mut contract = setup();
    let ctx = get_context(accounts(0));
    testing_env!(ctx.build());

    contract.transfer_ownership(accounts(1));

    let logs = near_sdk::test_utils::get_logs();
    assert!(
        logs.iter().any(|l| l.contains("ownership_transfer_initiated")),
        "Expected ownership_transfer_initiated event, got: {:?}",
        logs
    );
}

#[test]
fn test_accept_ownership_emits_event() {
    let mut contract = setup();

    let ctx = get_context(accounts(0));
    testing_env!(ctx.build());
    contract.transfer_ownership(accounts(1));

    let ctx = get_context(accounts(1));
    testing_env!(ctx.build());
    contract.accept_ownership();

    let logs = near_sdk::test_utils::get_logs();
    assert!(
        logs.iter().any(|l| l.contains("ownership_transferred")),
        "Expected ownership_transferred event, got: {:?}",
        logs
    );
}

#[test]
fn test_cancel_ownership_emits_event() {
    let mut contract = setup();

    let ctx = get_context(accounts(0));
    testing_env!(ctx.build());
    contract.transfer_ownership(accounts(1));
    contract.cancel_ownership_transfer();

    let logs = near_sdk::test_utils::get_logs();
    assert!(
        logs.iter().any(|l| l.contains("ownership_transfer_cancelled")),
        "Expected ownership_transfer_cancelled event, got: {:?}",
        logs
    );
}