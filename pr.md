# fix: resolve test coverage, documentation, and harvest exclusion issues (#496, #500, #541, #542)

Closes #496
Closes #500
Closes #541
Closes #542

## Summary

This PR addresses four outstanding testing, documentation, and design clarification issues:

**#541 — Test: `preview_deposit_to_shares` with zero assets returns zero shares**
- Added `test_preview_deposit_to_shares_zero_assets_returns_zero` in `test_shares.rs` covering:
  1. Empty vault (total_shares == 0, total_assets == 0) — zero input returns zero.
  2. After deposits exist (positive share price) — zero input still returns zero.

**#542 — Test: rebalance that fails on protocol exit leaves vault state unchanged**
- Added `test_rebalance_exit_failure_leaves_protocol_unchanged` in `test_rebalance.rs` verifying:
  1. `CurrentProtocol` does not change when exit is incomplete.
  2. `RebalanceFailedEvent` is emitted with reason `"exit_fail"`.
  3. Total assets are conserved (idle + deployed = original deposit).

**#500 — Document that `set_user_strategy` has no on-chain effect on rebalance/deposit targeting**
- Updated doc comments on `set_user_strategy` and `get_user_strategy` in `lib.rs` to explicitly state the strategy is storage-only and consumed off-chain by the AI agent.
- Added note to README.md "Three Investment Strategies" section.
- Added `UserStrategy(Address)` row to the Persistent Storage table in `ARCHITECTURE.md` with a storage-only callout.

**#496 — Wire `harvest()` failures into the consecutive-failure circuit breaker**
- Documented in `lib.rs` (near the rebalance section) that no `harvest()` entrypoint exists in the contract. Yield is reported via `update_total_assets()` which has no separate harvest step. If a future version introduces `harvest()`, it should report outcomes to the circuit-breaker helper.

## Verification

- [x] `test_preview_deposit_to_shares_zero_assets_returns_zero` passes.
- [x] `test_rebalance_exit_failure_leaves_protocol_unchanged` passes.
- [x] Documentation (`lib.rs`, `README.md`, `ARCHITECTURE.md`) updated and verified.
