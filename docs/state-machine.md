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
