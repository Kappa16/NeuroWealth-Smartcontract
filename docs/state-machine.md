# NeuroWealth Vault — Protocol State Machine

This document describes the lifecycle of the NeuroWealth Vault smart contract,
including all states, transitions, and the actions restricted in each state.

---

## State Diagram

```mermaid
stateDiagram-v2
    [*] --> Active : initialize()

    Active --> Paused : owner calls pause()
    Paused --> Active : owner calls unpause()

    Active --> Rebalancing : agent calls rebalance()
    Rebalancing --> Active : rebalance() completes

    Active --> Emergency : owner calls emergency_pause()
    Paused --> Emergency : owner calls emergency_pause()
    Emergency --> Active : owner resolves + calls unpause()

    Active --> PendingAgentUpdate : owner calls update_agent()
    PendingAgentUpdate --> Active : timelock expires + agent calls execute_agent_update()
    PendingAgentUpdate --> Active : owner calls cancel_agent_update()

    Active --> PendingUpgrade : owner calls schedule_upgrade()
    PendingUpgrade --> Active : timelock expires + owner calls execute_upgrade()
    PendingUpgrade --> Active : owner calls cancel_upgrade()

    state Rebalancing {
        [*] --> Idle : CurrentProtocol = "none"
        [*] --> Blend : CurrentProtocol = "blend"
        [*] --> DEX   : CurrentProtocol = "dex"
        Idle --> Blend : rebalance("blend", ...)
        Idle --> DEX   : rebalance("dex", ...)
        Blend --> Idle : rebalance("none", ...)
        Blend --> DEX  : rebalance("dex", ...) — exits Blend first
        Blend --> Blend : harvest(min_out) — withdraws and re-supplies
        DEX --> Idle   : rebalance("none", ...)
        DEX --> Blend  : rebalance("blend", ...) — exits DEX first
        DEX --> DEX     : harvest(min_out) — withdraws and re-supplies
    }
```

---

## State Transition Table

| From        | To          | Trigger                        | Who     | Precondition                              | Restricted During Transition         |
|-------------|-------------|-------------------------------|---------|-------------------------------------------|--------------------------------------|
| `Active`    | `Paused`    | `pause()`                     | Owner   | Vault not already paused                  | Deposits, withdrawals blocked after  |
| `Paused`    | `Active`    | `unpause()`                   | Owner   | Vault is paused                           | —                                    |
| `Active`    | `Rebalancing` | `rebalance()`               | Agent   | Not paused; cooldown elapsed              | None (vault accepts deposits during) |
| `Rebalancing` | `Active`  | `rebalance()` returns         | Agent   | Automatic on function return              | —                                    |
| `Active`    | `Emergency` | `emergency_pause()`           | Owner   | Vault not already in emergency            | Deposits, withdrawals blocked after  |
| `Paused`    | `Emergency` | `emergency_pause()`           | Owner   | Vault is paused (re-sets same flag)       | —                                    |
| `Emergency` | `Active`    | owner resolves + `unpause()`  | Owner   | Emergency condition manually cleared      | —                                    |
| `Active`    | `PendingAgentUpdate` | `update_agent()` | Owner   | No pending agent update already           | New agent changes deferred until timelock |
| `PendingAgentUpdate` | `Active` | timelock expires + `execute_agent_update()` | Agent | Timelock elapsed; pending proposal exists | —                                    |
| `PendingAgentUpdate` | `Active` | `cancel_agent_update()` | Owner | Pending proposal exists                  | —                                    |
| `Active`    | `PendingUpgrade` | `schedule_upgrade()` | Owner   | No pending upgrade already                | WASM changes deferred until timelock |
| `PendingUpgrade` | `Active` | timelock expires + `execute_upgrade()` | Owner | Timelock elapsed; pending proposal exists | —                                    |
| `PendingUpgrade` | `Active` | `cancel_upgrade()` | Owner | Pending proposal exists                  | —                                    |

---

## Per-State Description

### Active

Normal operating state. The vault accepts deposits and processes withdrawals.
Funds may be held directly in the vault or deployed via an external protocol
(Blend or a DEX). The share price is updated via `update_total_assets()`.

**Who can trigger entry:** `initialize()` (deployer), `unpause()` (owner).

**Preconditions:**
- `DataKey::Paused` is either absent or `false`.
- `DataKey::CurrentProtocol` may be `"blend"`, `"dex"`, or `"none"`.

**DEX sub-state:** When `CurrentProtocol == "dex"` the vault's USDC is
deployed to a configured DEX liquidity pool. Rebalancing to `"blend"` or
`"none"` exits the DEX position first (remove_liquidity), then enters the
target protocol. A failed DEX exit leaves `CurrentProtocol` unchanged.

**Blocked actions:** None — all user and admin operations available. The AI agent may also call `harvest(min_out)` while `CurrentProtocol` is `"blend"` or `"dex"`; the call exits and re-enters the same protocol and leaves `CurrentProtocol` unchanged.

---

### Paused

The owner has halted normal operations. No deposits or withdrawals are processed.
Triggered by `pause()` (error code for unauthorized caller: `OnlyOwnerCanPause = 19`).

**Who can trigger entry:** Owner via `pause()`.

**Preconditions:** Vault must be in `Active` state.

**Blocked actions:**
- `deposit()` — reverts with `Error(Contract, #35)`
- `withdraw()` — reverts with `Error(Contract, #35)`
- `withdraw_all()` — reverts with `Error(Contract, #35)`

**Admin actions still allowed:** `unpause()`, `set_tvl_cap()`, `set_owner()`, `upgrade()`.

---

### Rebalancing

An implicit transient state during execution of `rebalance()`. The agent is moving
funds between protocols (e.g., Blend → Vault or Vault → DEX). There is no
explicit storage flag for this state; it is bounded by the single Soroban
transaction that runs `rebalance()`.

**Who can trigger entry:** Agent via `rebalance()`.

**Preconditions:**
- Vault must be in `Active` state (not paused).
- Current ledger ≥ `LastRebalanceLedger + MinRebalanceInterval` (cooldown enforced).

**Blocked actions:**
- None — Soroban's single-threaded execution model means no concurrent
  state mutation is possible during the transaction.

**Note:** Calling `rebalance()` before the cooldown period has elapsed is
rejected. The cooldown is tracked via `DataKey::LastRebalanceLedger` and
`DataKey::MinRebalanceInterval`.

---

### Emergency

A distinct pause mode triggered by `emergency_pause()` when the owner detects
an abnormal condition requiring immediate fund protection. Separate from the
regular `pause()` path; unauthorized callers receive
`OnlyOwnerCanEmergencyPause = 22`.

**Who can trigger entry:** Owner via `emergency_pause()`.

**Preconditions:** Vault is in `Active` or `Paused` state.

**Blocked actions:**
- `deposit()` — reverts with `Error(Contract, #35)`
- `withdraw()` — reverts with `Error(Contract, #35)`
- `withdraw_all()` — reverts with `Error(Contract, #35)`
- `rebalance()` — blocked while paused

**Resolution path:** Owner investigates the incident, applies any needed
remediation (off-chain or via upgrade), then calls `unpause()` to return
the vault to `Active`.

> **Implementation note:** Paused and Emergency states share the same on-chain
> storage flag (`DataKey::Paused = true`). Off-chain systems cannot distinguish
> between a regular pause and an emergency pause by inspecting storage alone —
> they must check emitted event topics (`"pause"` vs `"emergency_pause"`) to
> determine which path was taken.

---

### PendingAgentUpdate

A timelocked state triggered when the owner calls `update_agent()` to propose a new agent address. The new agent does not take effect immediately; instead, a proposal is recorded with an expiry ledger. This provides a recovery window during which the proposal can be cancelled if it was made in error or maliciously.

**Who can trigger entry:** Owner via `update_agent()`.

**Preconditions:**
- Vault must be in `Active` state (not paused).
- No pending agent update already exists (`DataKey::PendingAgentUpdateHash` absent).

**Blocked actions:**
- `update_agent()` — rejected with `TimelockAlreadyPending` (#48) while another proposal is active.
- `execute_agent_update()` — rejected with `TimelockNotElapsed` (#47) before the expiry ledger is reached.

**Valid during timelock:**
- Deposits, withdrawals, and rebalancing continue normally — the vault remains operationally `Active`.
- `cancel_agent_update()` can be called by the owner at any time to clear the pending proposal.

**Exit paths:**
1. **Execute:** Once `ledger().sequence() >= AgentTimelockExpiry`, the agent calls `execute_agent_update()` to apply the new address. This clears the pending proposal and updates `DataKey::Agent`.
2. **Cancel:** The owner calls `cancel_agent_update()` at any time to abandon the proposal, clearing the pending storage keys.

**Storage keys:**
- `DataKey::PendingAgentUpdateHash` — the proposed new agent address.
- `DataKey::AgentTimelockExpiry` — the ledger sequence at which execution becomes allowed.

---

### PendingUpgrade

A timelocked state triggered when the owner calls `schedule_upgrade()` to propose a new WASM binary. Like the agent update, this defers the contract upgrade to provide a recovery window. This is the highest-stakes admin action as it replaces the contract's executable code.

**Who can trigger entry:** Owner via `schedule_upgrade()`.

**Preconditions:**
- Vault must be in `Active` state (not paused).
- No pending upgrade already exists (`DataKey::PendingUpgradeHash` absent).

**Blocked actions:**
- `schedule_upgrade()` — rejected with `TimelockAlreadyPending` (#48) while another proposal is active.
- `execute_upgrade()` — rejected with `TimelockNotElapsed` (#47) before the expiry ledger is reached.

**Valid during timelock:**
- Deposits, withdrawals, and rebalancing continue normally — the vault remains operationally `Active`.
- `cancel_upgrade()` can be called by the owner at any time to clear the pending proposal.

**Exit paths:**
1. **Execute:** Once `ledger().sequence() >= UpgradeTimelockExpiry`, the owner calls `execute_upgrade()` to apply the new WASM. This clears the pending proposal and invokes Soroban's built-in upgrade mechanism.
2. **Cancel:** The owner calls `cancel_upgrade()` at any time to abandon the proposal, clearing the pending storage keys.

**Storage keys:**
- `DataKey::PendingUpgradeHash` — the hash of the proposed new WASM binary.
- `DataKey::UpgradeTimelockExpiry` — the ledger sequence at which execution becomes allowed.

---

## Storage Keys Referenced

| Key                       | Type     | Description                                  |
|---------------------------|----------|----------------------------------------------|
| `DataKey::Paused`         | `bool`   | `true` while vault is paused                 |
| `DataKey::CurrentProtocol`| `Symbol` | Active deployment target: `"blend"` / `"dex"` / `"none"` |
| `DataKey::LastRebalanceLedger` | `u32` | Ledger sequence of last rebalance           |
| `DataKey::MinRebalanceInterval` | `u32` | Minimum ledgers between rebalances         |
| `DataKey::TvLCap`         | `i128`   | Maximum TotalAssets the vault will accept    |
| `DataKey::DexPool`        | `Address`| Configured DEX liquidity pool address (optional) |
| `DataKey::ApprovalTtl`    | `u32`    | Ledgers added to current sequence for DEX token approvals |
| `DataKey::PendingAgentUpdateHash` | `Address` | Proposed new agent address (timelock pending) |
| `DataKey::AgentTimelockExpiry` | `u32` | Ledger at which pending agent update becomes executable |
| `DataKey::PendingUpgradeHash` | `BytesN<32>` | Proposed new WASM hash (timelock pending) |
| `DataKey::UpgradeTimelockExpiry` | `u32` | Ledger at which pending upgrade becomes executable |

---

## Protocol Invariants

The following invariants must hold at every transaction boundary — i.e., at
any point that an external caller can observe on-chain state. They are
enumerated here as a state-machine complement to the full proof sketches in
[`ARCHITECTURE.md — Formal Invariant Register`](../ARCHITECTURE.md#formal-invariant-register).

> **Soroban atomicity guarantee:** All storage mutations within a single
> transaction commit or revert as one unit. The invariants below hold at the
> post-commit state; they may be transiently broken *within* a transaction's
> execution frame, but no external observer can see that intermediate state.

---

### I-1 — Share Sum Consistency

| | |
|---|---|
| **Formula** | `∑ Shares(u) == TotalShares` |
| **Plain English** | The sum of every user's share balance equals the contract-wide total-shares counter. |
| **Holds because** | `deposit()` and `withdraw()` are the only writers of `Shares(u)` and `TotalShares`. Both functions update the two counters by the same delta — `shares_minted` on deposit and `shares_burned` on withdrawal — within the same atomic transaction. Soroban's single-threaded execution prevents concurrent mutations. |
| **Violation window** | None observable externally. |
| **Enforcing targets** | `fuzz/fuzz_targets/share_accounting_invariants.rs`, `fuzz/fuzz_targets/deposit_withdraw_sequence.rs`, `tests/test_balance_shares_invariant.rs`, `tests/test_shares.rs` |

---

### I-2 — Proportional Balance

| | |
|---|---|
| **Formula** | `user_balance(u) == floor( Shares(u) × TotalAssets / TotalShares )` |
| **Plain English** | A user's redeemable USDC amount equals their proportional share of total managed assets, floored. |
| **Holds because** | `get_balance(user)` computes this formula at read time from committed storage — it is not a separate stored field that can drift. `checked_mul` prevents overflow. |
| **Violation window** | None observable externally; `TotalAssets` and `TotalShares` are updated together before `Shares(user)` in a single transaction. |
| **Enforcing targets** | `fuzz/fuzz_targets/share_accounting_invariants.rs`, `tests/test_balance_shares_invariant.rs`, `tests/test_rounding_math.rs` |

---

### I-3 — Non-Negative Yield

| | |
|---|---|
| **Formula** | `TotalAssets >= TotalDeposits` |
| **Plain English** | Managed assets are always at least as large as principal deposited; accrued yield is never negative. |
| **Holds because** | `deposit()` and `withdraw()` move both counters by the same delta. `update_total_assets()` can only increase `TotalAssets` (decreases are capped at ≤10% per call via basis-point guard, and the function rejects values below the current total). |
| **Violation window** | None. |
| **Enforcing targets** | `fuzz/fuzz_targets/share_accounting_invariants.rs`, `tests/test_total_assets_cap.rs` |

---

### I-4 — Per-User Share Bound

| | |
|---|---|
| **Formula** | `Shares(u) <= TotalShares` for all `u` |
| **Plain English** | No single user can hold more shares than the entire share supply. |
| **Holds because** | Direct corollary of I-1: `TotalShares` is the sum of all non-negative user shares, so no individual entry can exceed the sum. |
| **Violation window** | None. |
| **Enforcing targets** | `fuzz/fuzz_targets/share_accounting_invariants.rs`, `tests/test_shares.rs` |

---

### I-5 — Per-User Asset Bound

| | |
|---|---|
| **Formula** | `user_balance(u) <= TotalAssets` for all `u` |
| **Plain English** | No single user's redeemable balance can exceed the vault's total managed assets. |
| **Holds because** | Follows from I-2 and I-4: `floor(Shares(u)/TotalShares × TotalAssets) ≤ TotalAssets` when `Shares(u) ≤ TotalShares`. Checked arithmetic prevents overflow from producing a spuriously large value. |
| **Violation window** | None. |
| **Enforcing targets** | `fuzz/fuzz_targets/share_accounting_invariants.rs`, `tests/test_balance_shares_invariant.rs` |

---

### I-6 — Non-Decreasing Exchange Rate

| | |
|---|---|
| **Formula** | `get_exchange_rate() >= 10_000_000` (rate ≥ 1.0 in 7-decimal fixed point) |
| **Plain English** | The vault exchange rate starts at exactly 1.0 at bootstrap and can only grow; it never decays below 1.0. |
| **Holds because** | Bootstrap sets `TotalAssets == TotalShares` (1:1 initial deposit). `update_total_assets()` only increases `TotalAssets`, so the rate only rises. Withdrawals burn shares proportional to assets returned, leaving the rate unchanged. Deposits use floor division for `shares_minted`, so depositors receive ≤ their exact proportional share — this cannot decrease the rate. |
| **Violation window** | None. Floor-on-deposit and increase-only `update_total_assets` together prevent any decrease. |
| **Enforcing targets** | `fuzz/fuzz_targets/share_accounting_invariants.rs`, `fuzz/fuzz_targets/rounding_boundaries.rs`, `tests/test_exchange_rate.rs`, `tests/test_rounding_math.rs` |

---

### I-7 — Idle + Deployed vs TotalAssets (Informational)

| | |
|---|---|
| **Formula** | `get_idle_balance() + get_deployed_assets() ≈ TotalAssets` |
| **Plain English** | The sum of idle USDC and externally deployed USDC is observable but may differ from `TotalAssets`. `TotalAssets` is the sole authoritative value for share pricing. |
| **Why the difference exists** | `TotalAssets` is updated by the AI agent via `update_total_assets()` to report accrued yield. Until that call is made, `idle + deployed` (which reads live on-chain token balances) may lag `TotalAssets`. Conversely, yield may have accrued on-chain (e.g., in Blend) but not yet been reported, causing `idle + deployed` to exceed `TotalAssets`. |
| **Design intent** | Isolates share pricing from the latency of cross-contract balance reads and from protocol-side rounding. `idle + deployed` is an operational observability aid, not an accounting primitive. |
| **Violation window** | A gap between `idle + deployed` and `TotalAssets` is normal at any live point in time. The figures converge after `update_total_assets()` reports the latest yield. |
| **Enforcing targets** | `fuzz/fuzz_targets/share_accounting_invariants.rs`, `tests/test_total_assets_cap.rs` |

---

### Invariant Dependency Map

```
I-1  (sum shares == TotalShares)
  └── I-4  (Shares(u) <= TotalShares)   [corollary]
       └── I-5  (user_balance <= TotalAssets)  [via I-2]

I-2  (user_balance == floor(Shares × TotalAssets / TotalShares))
  └── I-5  (user_balance <= TotalAssets)   [corollary]

I-3  (TotalAssets >= TotalDeposits)   [independent]

I-6  (exchange_rate >= 1.0)           [independent]

I-7  (idle + deployed ≈ TotalAssets)  [informational, not a strict equality]
```

I-4 and I-5 are corollaries: confirming I-1 and I-2 implicitly confirms them.
Any audit that verifies I-1, I-2, I-3, I-6, and I-7 covers the complete
invariant set.
