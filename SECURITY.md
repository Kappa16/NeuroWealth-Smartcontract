# Security Model

This document describes the security architecture, trust model, and threat model for the NeuroWealth Vault contract.

## Trust Model

The NeuroWealth Vault implements a partitioned trust model with three distinct roles:

### Owner

The contract owner has the following permissions:
- **Pause/Unpause**: Can halt all deposits and withdrawals during emergencies
- **Set TVL Cap**: Can limit total deposits to manage risk exposure
- **Set User Deposit Cap**: Can limit per-user exposure
- **Update Agent**: Can change the authorized AI agent address
- **Upgrade Contract**: Can upgrade contract code (Phase 2)

The owner **CANNOT**:
- Access user funds directly
- Withdraw funds from user accounts
- Modify user balances

### AI Agent

The authorized AI agent has the following permissions:
- **Rebalance**: Can call `rebalance()` to signal strategy changes and move funds between protocols
- **Update Total Assets**: Can report yield accrual or strategy losses
- **Read Access**: Can read all vault state to make yield decisions

The agent **CANNOT**:
- Withdraw user funds directly to itself
- Change vault configuration (caps, pools)
- Access USDC tokens directly outside of protocol interactions
- Modify user balances without valid asset reporting
- Pause or unpause the vault (owner-only, including emergency pause)

### Users

Regular users have the following permissions:
- **Deposit**: Can deposit USDC into the vault
- **Withdraw**: Can withdraw their own USDC at any time
- **Read**: Can query their balance and vault state

Users **CANNOT**:
- Access other users' funds
- Manipulate vault configuration
- Call agent-only or owner-only functions

## Withdrawal Guarantees

### Automated Liquidity Management

The vault automatically manages liquidity between idle USDC (held in the contract) and deployed assets (e.g., in Blend protocol):
1. **Idle Withdrawals**: If the vault holds sufficient idle USDC, withdrawals are processed immediately.
2. **Protocol Withdrawals**: If idle USDC is insufficient, the vault automatically attempts to withdraw the required amount from the active protocol (e.g., Blend).
3. **Partial Withdrawals**: If the protocol has insufficient liquidity (e.g., high utilization), the user receives all available USDC and **retains their remaining shares** in the vault. This ensures users are not forced into unfavorable liquidations during protocol-wide liquidity crunches.

### Withdrawal Priority

Users can withdraw their USDC at any time without:
- Lock-up periods
- Withdrawal fees
- Approval requirements beyond their signature

## Risk Analysis

### 1. External Protocol Risk (Blend & DEX)

The vault can route idle USDC into external protocols (`get_current_protocol` reports `idle`, `blend`, or `dex`). Each integration introduces systemic risk:
- **Liquidity Risk (Blend)**: If Blend utilization is 100%, the vault cannot pull funds immediately. Users will experience partial withdrawals until liquidity returns to the protocol.
- **Slippage & Liquidity Risk (DEX)**: When the active strategy is a DEX pool, withdrawals and strategy switches execute swaps. Thin pool liquidity can cause slippage or a failed switch; the low-liquidity strategy-switch path returns funds to idle rather than forcing an unfavorable swap.
- **Protocol Failure**: A bug or exploit in Blend or the DEX could result in loss of deployed assets.

### 2. Asset Reporting Risk

The `update_total_assets` function used by the AI agent has built-in guardrails:
- **Solvency Check**: The agent cannot inflate total assets beyond the combined balance of idle USDC and funds actually deployed to external protocols.
- **Decrease Bounding**: Reporting a loss is capped (default 10% per call) to prevent sudden, massive devaluations from a single malicious or erroneous call.

### 3. Agent Rebalance Risk

The AI agent can move funds between protocols via `rebalance()`, but is constrained:
- **Rebalance Cooldown**: Consecutive rebalances are rate-limited by a configurable cooldown (`get_rebalance_cooldown` / `get_last_rebalance_ledger`), which bounds how quickly a compromised or malfunctioning agent can churn funds across protocols.
- **No Direct Custody**: Rebalancing only moves funds between the vault's own positions in whitelisted pools; the agent cannot redirect funds to an arbitrary address.

### 4. Upgrade Risks

The contract owner can upgrade the contract code. To protect against malicious or accidental instant code changes, upgrade risk is mitigated via a mandatory two-step timelock mechanism:
- **Two-Step Timelock**: Upgrades must first be scheduled via `schedule_upgrade(new_wasm_hash)`, initiating a timelock delay before `execute_upgrade()` can be called.
- **Cancellation Window**: During the timelock window, the owner or security monitoring can invoke `cancel_upgrade()` to abort a compromised or erroneous upgrade proposal.
- **Owner Multi-Sig Recommended**: For mainnet deployment, owner authority should be held by a multi-sig account.

### 5. State Rent & TTL Expiry

Soroban persistent entries (such as each user's `Shares` record) accrue state rent and expire if their TTL is not periodically extended:
- **Pure Read-Only Getters**: `get_balance` and `get_shares` are side-effect free — they do **not** extend storage TTL. This keeps pure reads cheap and prevents read traffic from silently mutating ledger state.
- **Explicit Maintenance**: Off-chain indexers or maintenance jobs should call the permissionless `touch_user_ttl(user)` to refresh a user's `Shares` TTL. State-changing calls (`deposit`, `withdraw`) already rewrite `Shares` and refresh its TTL during normal operation.
- **Risk**: A long-dormant user who never transacts and whose entry is never touched could see their `Shares` entry expire and require restoration. Active users, and any indexer running `touch_user_ttl`, are unaffected.

## Access Control Summary

| Function | Owner | Agent | User | Anyone |
|----------|-------|-------|------|--------|
| update_agent | yes | - | - | - |
| confirm_agent_update | yes | - | - | - |
| cancel_agent_update | yes | - | - | - |
| update_total_assets | - | yes | - | - |
| deposit | - | - | yes | - |
| withdraw | - | - | yes | - |
| withdraw_all | - | - | yes | - |
| rebalance | - | yes | - | - |
| pause | yes | - | - | - |
| emergency_pause | yes | - | - | - |
| unpause | yes | - | - | - |
| set_caps | yes | - | - | - |
| set_tvl_cap | yes | - | - | - |
| set_user_deposit_cap | yes | - | - | - |
| set_deposit_limits | yes | - | - | - |
| set_limits | yes | - | - | - |
| set_rebalance_cooldown | yes | - | - | - |
| set_approval_ttl | yes | - | - | - |
| set_blend_approval_ttl | yes | - | - | - |
| schedule_upgrade | yes | - | - | - |
| execute_upgrade | yes | - | - | - |
| cancel_upgrade | yes | - | - | - |
| set_blend_pool | yes | - | - | - |
| set_dex_pool | yes | - | - | - |
| transfer_ownership | yes | - | - | - |
| cancel_ownership_transfer | yes | - | - | - |
| accept_ownership | - | - | - | pending owner |
| touch_user_ttl | - | - | - | anyone |
| set_user_strategy | - | - | yes | - |

### Emergency Harvest Fallback (Issue #506)

When the agent key is lost, compromised, or mid-rotation via the
`update_agent` timelock, the normal `harvest()` function is unusable because
it requires agent authorization. The owner can call `emergency_harvest(min_out)`
to compound yield during this window:

- **Gating**: Owner auth only (not agent auth)
- **Pause bypass**: Works even when the vault is paused, so the owner can
  compound yield during an emergency pause without unpausing first
- **Same mechanics**: Withdraws accrued yield from the active protocol and
  re-supplies it (same round-trip as `harvest()`)
- **Distinct event**: Emits `EmergencyHarvestEvent` (topic `em_harv`) so
  indexers can differentiate from agent-initiated `HarvestEvent` (topic
  `harvest`)

| Function | Owner | Agent | User | Anyone |
|----------|-------|-------|------|--------|
| emergency_harvest | yes | - | - | - |

## Security Best Practices Implemented

1. **Checks-Effects-Interactions Pattern**: All state updates happen before external calls
2. **Auth on Withdrawals**: `require_auth()` ensures users can only access their own funds
3. **Minimum Deposits**: Prevents dust attacks
4. **Deposit Caps**: Limits exposure per user
5. **TVL Caps**: Limits total exposure
6. **Pausable**: Emergency stop functionality

## Owner-Compromise Response Runbook

If the owner keypair is suspected or confirmed to be compromised, follow this
sequence immediately. Every step that requires owner auth is marked **[owner]**.

For agent-key compromise procedures, see the [Agent-Key Compromise Runbook](docs/AGENT_KEY_COMPROMISE_RUNBOOK.md).

### Step 1 — Pause the vault (within minutes)

The single fastest action to protect user funds is an emergency pause. No new
deposits or withdrawals can execute while the vault is paused.

```bash
stellar contract invoke \
  --id $VAULT_CONTRACT_ID \
  --source <OWNER_SECRET_KEY> \
  --network mainnet \
  -- pause
```

**Requires**: owner auth **[owner]**

> **Note:** Unlike `pause`, the `emergency_pause` function also requires owner
> auth. If the owner key is already confirmed compromised and you cannot sign
> with it, see Step 2 to assess whether the attacker has already rotated
> the owner address.

### Step 2 — Assess exposure

Before taking further action, determine what the attacker could have done or
is still doing:

| Check | Command |
|---|---|
| Current paused state | `stellar contract invoke --id $VAULT_CONTRACT_ID --network mainnet -- get_paused` |
| Current owner address | `stellar contract invoke --id $VAULT_CONTRACT_ID --network mainnet -- get_owner` |
| Current agent address | `stellar contract invoke --id $VAULT_CONTRACT_ID --network mainnet -- get_agent` |
| Pending agent update | `stellar contract invoke --id $VAULT_CONTRACT_ID --network mainnet -- get_pending_agent_update` |
| Pending contract upgrade | `stellar contract invoke --id $VAULT_CONTRACT_ID --network mainnet -- get_pending_upgrade` |
| Active protocol (idle/blend/dex) | `stellar contract invoke --id $VAULT_CONTRACT_ID --network mainnet -- get_current_protocol` |
| TVL cap | `stellar contract invoke --id $VAULT_CONTRACT_ID --network mainnet -- get_tvl_cap` |

Owner-only actions an attacker with the key could have taken:
- Initiated `update_agent` or `schedule_upgrade` to queue a malicious agent or WASM upgrade.
- Called `set_blend_pool` or `set_dex_pool` to point the vault at a drain contract.
- Called `set_caps` to raise or remove deposit limits.
- Initiated `transfer_ownership` to a new address they control.

**The attacker cannot directly withdraw user funds** — withdrawals require
the *user's* own auth signature, not the owner key.

### Step 3 — Rotate the owner key

Generate a new owner keypair on an air-gapped machine. Then initiate the
two-step ownership transfer from the current (compromised) key while you still
control it:

```bash
# Step 3a — propose new owner [owner]
stellar contract invoke \
  --id $VAULT_CONTRACT_ID \
  --source <CURRENT_OWNER_SECRET_KEY> \
  --network mainnet \
  -- transfer_ownership \
  --new_owner <NEW_OWNER_ADDRESS>

# Step 3b — accept from the new keypair [pending owner]
stellar contract invoke \
  --id $VAULT_CONTRACT_ID \
  --source <NEW_OWNER_SECRET_KEY> \
  --network mainnet \
  -- accept_ownership
```

If the compromised key has already been used to initiate an attacker-controlled
`transfer_ownership`, the pending owner is stored under `DataKey::PendingOwner`.
You must call `accept_ownership` from the *legitimate* new owner before the
attacker does. Check `DataKey::PendingOwner` on-chain immediately.

### Step 4 — Revert any attacker configuration changes & pending timelocks

Once the new owner key is in place, audit and reset all owner-controlled state and cancel pending malicious timelocks:

```bash
# Cancel any pending malicious agent update or contract upgrade scheduled by attacker [owner]
stellar contract invoke --id $VAULT_CONTRACT_ID --source <NEW_OWNER_KEY> \
  --network mainnet -- cancel_agent_update

stellar contract invoke --id $VAULT_CONTRACT_ID --source <NEW_OWNER_KEY> \
  --network mainnet -- cancel_upgrade

# Initiate and confirm agent update to legitimate AI agent address via timelock [owner]
stellar contract invoke --id $VAULT_CONTRACT_ID --source <NEW_OWNER_KEY> \
  --network mainnet -- update_agent --new_agent <LEGITIMATE_AGENT_ADDRESS>

# (After timelock window expires)
stellar contract invoke --id $VAULT_CONTRACT_ID --source <NEW_OWNER_KEY> \
  --network mainnet -- confirm_agent_update

# Reset pool addresses to audited contracts [owner]
stellar contract invoke --id $VAULT_CONTRACT_ID --source <NEW_OWNER_KEY> \
  --network mainnet -- set_blend_pool --pool_address <AUDITED_BLEND_POOL>

stellar contract invoke --id $VAULT_CONTRACT_ID --source <NEW_OWNER_KEY> \
  --network mainnet -- set_dex_pool --pool_address <AUDITED_DEX_POOL>

# Restore caps to pre-incident values [owner]
stellar contract invoke --id $VAULT_CONTRACT_ID --source <NEW_OWNER_KEY> \
  --network mainnet -- set_caps \
  --user_deposit_cap <ORIGINAL_CAP> --tvl_cap <ORIGINAL_TVL_CAP>
```

### Step 5 — Restore safe operation

Only unpause once Steps 1–4 are fully complete and verified.

```bash
stellar contract invoke \
  --id $VAULT_CONTRACT_ID \
  --source <NEW_OWNER_SECRET_KEY> \
  --network mainnet \
  -- unpause
```

**Requires**: owner auth **[owner]**

### Step 5a — Emergency harvest during agent-key rotation

If the vault has funds deployed to a protocol (Blend or DEX) and the agent
key is being rotated, use `emergency_harvest` to compound yield without
waiting for the new agent key:

```bash
stellar contract invoke \
  --id $VAULT_CONTRACT_ID \
  --source <NEW_OWNER_SECRET_KEY> \
  --network mainnet \
  -- emergency_harvest \
  --min_out 0
```

**Requires**: owner auth **[owner]**

> **Note:** `emergency_harvest` bypasses the paused-state check, so it can be
> called before or after `unpause`. It still respects the rebalance cooldown
> and requires an active protocol (panics with `UnsupportedProtocol`
> if `CurrentProtocol == "none"`). The emitted `EmergencyHarvestEvent` (topic
> `em_harv`) is distinct from the regular `HarvestEvent` (topic `harvest`).
>
> Resume normal agent-initiated `harvest()` calls once the new agent key is
> confirmed.

### Step 6 — Post-incident

- Revoke and rotate all credentials that were co-located with the compromised key.
- Publish a post-mortem within 72 hours.
- Consider migrating to a multi-sig owner address before resuming normal operations.

---

## Audit & Mainnet Deployment Checklist

Before any mainnet deployment, you must refer to and complete the formal [Mainnet Deployment Checklist](docs/MAINNET_CHECKLIST.md).

Additionally, ensure:

- [ ] All functions have documented panic conditions
- [ ] All state changes emit events
- [ ] Access control verified for each function
- [ ] Upgrade mechanism tested on testnet
- [ ] Pause/unpause tested
- [ ] Withdrawal flow tested with edge cases
- [ ] Maximum deposit limits enforced
- [ ] TVL cap enforced
- [ ] Integration with USDC token tested
- [ ] Integration with Blend protocol tested (Phase 2)
