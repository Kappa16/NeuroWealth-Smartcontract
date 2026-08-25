# NeuroWealth Vault — Monitoring & Audit Trail Strategy

Operations guide for running the NeuroWealth Vault in production.
All signals reference on-chain state read from the Stellar/Soroban ledger.

---

## 1. Routine Signals

Monitor these metrics continuously across every ledger window.

| Signal                       | How to Measure                                                          | Healthy Range                                       |
| ---------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| TVL (TotalAssets)            | `get_total_assets()` per ledger                                         | Monotonically non-decreasing absent withdrawals     |
| TVL growth rate              | `(TotalAssets_now - TotalAssets_1h_ago) / TotalAssets_1h_ago`           | Positive or flat; sharp drops warrant investigation |
| Deposit volume per ledger    | Count `deposit()` calls + sum of amounts in ledger window               | Tracks user inflow                                  |
| Withdrawal volume per ledger | Count `withdraw()` + `withdraw_all()` calls + amounts                   | Tracks user outflow                                 |
| Rebalance frequency          | Count `rebalance()` calls per hour; compare to `MinRebalanceInterval`   | Never more frequent than cooldown allows            |
| Share price                  | `get_total_assets() / get_total_shares()`                               | Must be monotonically non-decreasing                |
| Yield accrual                | `get_total_assets()` before and after each `update_total_assets()` call | Delta ≥ 0 (no unexpected decrease)                  |
| TVL headroom                 | `(TvlCap - TotalAssets) / TvlCap`                                       | Alert when < 5% headroom remains                    |

---

## 2. Warning Signals (Anomalies)

These conditions indicate abnormal behavior and require prompt investigation.

| Anomaly                                     | Condition                                                    | Severity                             |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------------------ |
| Sudden TVL drop                             | `TotalAssets_now < TotalAssets_1h_ago * 0.80`                | Critical                             |
| Extended pause                              | `Paused == true` for more than 24 h                          | High                                 |
| Withdrawal spike                            | `withdrawal_volume_1h > withdrawal_volume_30d_avg * 3`       | High                                 |
| Cap saturation                              | Repeated `Error(Contract, #41)` rejections                   | Medium                               |
| Cooldown violation attempt                  | `rebalance()` called before cooldown elapsed                 | Medium                               |
| Share price decrease                        | `current_share_price < previous_share_price`                 | Critical                             |
| `update_total_assets` reporting lower value | New value < stored TotalAssets without `allow_decrease=true` | High                                 |
| Vault contract upgrade                      | `execute_upgrade()` called                                   | High — requires governance sign-off  |
| Upgrade scheduled                           | `schedule_upgrade()` called                                  | High — initiates 24h timelock window |
| Agent update proposed                       | `update_agent()` called                                      | High — initiates 24h timelock window |

---

## 3. Audit Trail

Track these on-chain events and storage mutations. Soroban events are indexed by
topic; the vault emits structured events for every significant state change.

### Admin Actions

| Action                      | Contract Function             | Event Topic | Who           |
| --------------------------- | ----------------------------- | ----------- | ------------- |
| Pause vault                 | `pause()`                     | `paused`    | Owner         |
| Unpause vault               | `unpause()`                   | `unpaused`  | Owner         |
| Emergency pause             | `emergency_pause()`           | `emerg`     | Owner         |
| Emergency harvest           | `emergency_harvest()`         | `em_harv`   | Owner         |
| Set TVL cap                 | `set_tvl_cap()`               | `tvl_cap`   | Owner         |
| Initiate ownership transfer | `transfer_ownership()`        | `own_init`  | Owner         |
| Accept ownership            | `accept_ownership()`          | `own_xfer`  | Pending Owner |
| Cancel ownership transfer   | `cancel_ownership_transfer()` | `own_cncl`  | Owner         |
| Propose agent update        | `update_agent()`              | `agt_prop`  | Owner         |
| Confirm agent update        | `confirm_agent_update()`      | `agt_conf`  | Owner         |
| Cancel agent update         | `cancel_agent_update()`       | `agt_cncl`  | Owner         |
| Schedule upgrade            | `schedule_upgrade()`          | `upg_sched` | Owner         |
| Execute upgrade             | `execute_upgrade()`           | `upgraded`  | Owner         |
| Cancel upgrade              | `cancel_upgrade()`            | `upg_cncl`  | Owner         |

### Parameter Changes

| Action                   | Contract Function              | What Changes                       |
| ------------------------ | ------------------------------ | ---------------------------------- |
| Set per-user deposit cap | `set_user_deposit_cap()`       | Max single-user cumulative deposit |
| Set minimum deposit      | `set_min_deposit()`            | Smallest accepted deposit amount   |
| Set Blend pool           | `set_blend_pool()`             | Target Blend pool address          |
| Set rebalance interval   | `set_min_rebalance_interval()` | Cooldown between rebalances        |

### Rebalance Executions

Each `rebalance()` call must be logged with:

- Source protocol (prior `CurrentProtocol`)
- Destination protocol (new `CurrentProtocol`)
- Amount moved
- Ledger sequence (timestamp proxy)
- Agent address

### Large Transactions

Flag any single `deposit()` or `withdraw()` where:

```
amount > get_total_assets() * 0.01
```

A deposit or withdrawal exceeding 1% of TVL in a single transaction warrants
manual review.

---

## 4. Alert Examples

```
ALERT: tvl_drop_20pct
  condition: get_total_assets() < TotalAssets_1h_ago * 0.80
  severity: critical
  action: Page on-call; suspend agent rebalance authority until reviewed

ALERT: pause_duration_exceeded
  condition: Paused == true AND current_ledger > pause_start_ledger + 17280
  note: 17280 ledgers ≈ 24 h at ~5 s/ledger
  severity: high
  action: Notify owner; investigate reason for extended pause

ALERT: withdrawal_spike
  condition: withdrawal_volume_1h > withdrawal_volume_30d_avg * 3
  severity: high
  action: Review for coordinated exit; check protocol health

ALERT: tvl_cap_approach
  condition: get_total_assets() > TvlCap * 0.95
  severity: medium
  action: Consider raising cap or preparing user communication

ALERT: share_price_decrease
  condition: (get_total_assets() / get_total_shares()) < previous_share_price
  severity: critical
  action: Halt new deposits; investigate slashing or accounting error

ALERT: rapid_rebalance_attempts
  condition: rebalance() called more than once within MinRebalanceInterval
  severity: medium
  action: Audit agent key; verify no unauthorized rebalance calls
```

---

## 5. Suspicious Activity Indicators

These patterns may indicate manipulation, insider abuse, or a compromised key.

| Pattern                                     | Description                                                                              | Response                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Deposit-withdraw cycling                    | Multiple accounts depositing near the cap and immediately withdrawing                    | Investigate for fee extraction or share-price manipulation                              |
| Admin address change without delay          | `transfer_ownership()` / `accept_ownership()` called unexpectedly or in rapid succession | Verify legitimacy; check for owner key compromise                                       |
| Rapid emergency pause cycles                | `emergency_pause()` / `unpause()` called multiple times within 24 h                      | Treat as potential exploit attempt; freeze agent authority                              |
| `update_total_assets()` reporting decrease  | `allow_decrease=false` but a lower value was passed (would revert)                       | Indicates misconfigured yield reporter or off-chain bug                                 |
| Malicious agent update or upgrade scheduled | `update_agent()` or `schedule_upgrade()` called unexpectedly                             | Investigate immediately; prepare to call cancel/emergency pause during the 24h timelock |
| Agent calling non-agent functions           | Agent address calling `pause()`, `set_tvl_cap()`, etc.                                   | Key misuse; rotate agent key immediately                                                |
| TVL cap set to 0                            | `set_tvl_cap(0)` effectively blocks all deposits                                         | Verify intent; could be accidental denial-of-service                                    |

### Pause Event Disambiguation

The vault emits two distinct event topics when entering a paused state.
Indexers **must** use the topic to distinguish the pause cause:

| Pause Cause                | Function Called          | Event Topic | Event Type             |
| -------------------------- | ------------------------ | ----------- | ---------------------- |
| Circuit-breaker auto-pause | `rebalance()` (internal) | `emerg`     | `EmergencyPausedEvent` |
| Owner-initiated pause      | `pause()`                | `paused`    | `VaultPausedEvent`     |
| Owner emergency pause      | `emergency_pause()`      | `emerg`     | `EmergencyPausedEvent` |

**Key distinction**: Both circuit-breaker auto-pause and `emergency_pause()`
emit `EmergencyPausedEvent` with topic `emerg`. Only `pause()` emits
`VaultPausedEvent` with topic `paused`. To determine whether the vault was
paused by the circuit breaker or by the owner, check:

1. **Event topic**: `emerg` → circuit breaker or emergency pause; `paused` →
   owner-initiated pause
2. **Timing correlation**: If an `emerg` event coincides with a failed
   `rebalance` transaction, it was the circuit breaker. If it correlates with
   a standalone `emergency_pause` call, it was the owner.

### Emergency Harvest Event

`emergency_harvest()` emits `EmergencyHarvestEvent` (topic `em_harv`), which is
distinct from the regular `HarvestEvent` (topic `harvest`). This allows
indexers to differentiate owner-initiated emergency harvests from
agent-initiated harvests during monitoring and audit trails.

---

## 6. Timelock Monitoring (Admin Key Compromise Mitigation)

To mitigate the risk of an admin key compromise, updates to the authorized AI agent (`update_agent`) and upgrades to the contract's WASM logic (`schedule_upgrade`) are protected by a mandatory 24-hour timelock (17,280 ledgers).

Operations teams must monitor on-chain events during this delay window to detect and react to unauthorized or malicious proposals before they can be executed.

### Events to Watch

| Event Name                  | Topic       | Phase             | Key Fields                                   |
| --------------------------- | ----------- | ----------------- | -------------------------------------------- |
| `AgentUpdateProposedEvent`  | `agt_prop`  | Step 1: Proposal  | `old_agent`, `new_agent`, `effective_ledger` |
| `AgentUpdateConfirmedEvent` | `agt_conf`  | Step 2: Execution | `old_agent`, `new_agent`                     |
| `AgentUpdateCancelledEvent` | `agt_cncl`  | Escape Hatch      | `old_agent`, `proposed_new_agent`            |
| `UpgradeScheduledEvent`     | `upg_sched` | Step 1: Proposal  | `new_wasm_hash`, `effective_ledger`          |
| `UpgradedEvent`             | `upgraded`  | Step 2: Execution | `old_version`, `new_version`                 |
| `UpgradeCancelledEvent`     | `upg_cncl`  | Escape Hatch      | `cancelled_wasm_hash`                        |

### Suspicious Patterns

1. **Unexpected Proposals**: Any `AgentUpdateProposedEvent` or `UpgradeScheduledEvent` emitted outside of officially announced maintenance/upgrade schedules.
2. **Rapid Succession**: A proposal immediately scheduled after a cancellation, which might indicate a struggle for control.
3. **Execution Immediately on Expiry**: A proposal confirmed (`AgentUpdateConfirmedEvent` or `UpgradedEvent`) the exact ledger it becomes effective, especially if ownership transfer is also active.

### Response Window & Actions

- **Response Window**: 17,280 ledgers (approximately 24 hours).
- **Mitigation Action (Cancellation)**: If a proposal is unauthorized or suspicious, the contract owner must immediately invoke the escape hatch:
  - For agent updates: call `cancel_agent_update()` (emits `AgentUpdateCancelledEvent`).
  - For contract upgrades: call `cancel_upgrade()` (emits `UpgradeCancelledEvent`).
- **Emergency Response**: If the owner key itself is compromised, the owner (or multisig/governance wallet, if applicable) must cancel the malicious proposal, pause the vault via `emergency_pause()` or `pause()`, and prepare for key rotation.

---

## 7. DEX-Specific Monitoring

When `CurrentProtocol == "dex"`, the following additional signals should be tracked
alongside the routine signals in section 1.

### Metrics

| Signal                | How to Measure                                                           | Healthy Range                               |
| --------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| DEX position balance  | `get_balance(vault_id)` on DEX pool contract                             | Matches expected deployed amount ± slippage |
| Rebalance slippage    | `(amount_intended - amount_actual) / amount_intended` in `dex_sup` event | < configured `min_out` floor                |
| Stuck liquidity       | `balance` on DEX pool unchanged across multiple rebalance cycles         | Should decrease to 0 after successful exit  |
| Pool address validity | `get_dex_pool()` returns expected address                                | Non-null and matches configured pool        |

### Alert Conditions

```
ALERT: dex_position_mismatch
  condition: DexPool.balance(vault_id) != expected_deployed_amount (±1%)
  severity: high
  action: Audit rebalance events; check for partial fill or pool accounting bug

ALERT: dex_abnormal_slippage
  condition: dex_sup event amount_actual < amount_intended * 0.99
             AND min_out was not triggered
  severity: medium
  action: Review pool depth; consider raising min_out or switching protocol

ALERT: dex_stuck_liquidity
  condition: CurrentProtocol == "none" AND DexPool.balance(vault_id) > 0
  severity: high
  action: Pool may not have fully returned funds on exit; check remove_liquidity
          return value and retry rebalance to "none"

ALERT: dex_pool_not_configured
  condition: get_dex_pool() returns None AND rebalance to "dex" attempted
  severity: critical
  action: Owner must call set_dex_pool() before DEX rebalances can proceed

ALERT: dex_supply_failed
  condition: dex_sup event emitted with success = false
  severity: high
  action: Pool rejected supply (cap hit or zero liquidity); rebalance to "none"
          or wait for pool capacity to recover
```

### Diagnosing Stuck DEX Liquidity

If a rebalance exit from DEX is suspected to have left funds in the pool:

```bash
# 1. Check on-chain protocol state
stellar contract invoke --id $VAULT_CONTRACT_ID --network mainnet \
  -- get_current_protocol

# 2. Query pool balance directly
stellar contract invoke --id $DEX_POOL_ADDRESS --network mainnet \
  -- balance --asset $USDC_ADDRESS --user $VAULT_CONTRACT_ID

# 3. Look for dex_wd events and their actual amounts
stellar events --network mainnet --start-ledger <RECENT_LEDGER> \
  --contract-id $VAULT_CONTRACT_ID | grep dex_wd
```

If `get_current_protocol` returns `"none"` but the DEX pool still holds a
non-zero balance for the vault, the exit leg completed from the vault's
perspective but the pool accounting drifted. Retry `rebalance("none", 0, 0)`;
if the pool still reports a balance after that, escalate to the pool operator.

### Misconfigured Pool Address

A pool address set to a contract that does not implement `add_liquidity`,
`remove_liquidity`, and `balance` will cause the first `rebalance("dex", ...)` to
panic. Validate the pool address off-chain before calling `set_dex_pool()`:

```bash
stellar contract invoke --id $PROPOSED_DEX_POOL --network mainnet \
  -- balance --asset $USDC_ADDRESS --user $VAULT_CONTRACT_ID
```

A successful (even zero) response confirms the interface is compatible.

---

## 9. Blend Protocol Bad-Debt Monitoring

When funds are deployed to Blend Protocol, the vault becomes sensitive to **socialized bad-debt events**. These occur when Blend recognizes collateral liquidations or defaults, reducing the total assets across all suppliers pro-rata.

Unlike vault-level withdrawals, bad-debt events do **not** emit vault-side events. Users see their balance drop without any transaction.

**See [`BLEND_INTEGRATION_RESEARCH.md` — Bad-Debt Analysis](BLEND_INTEGRATION_RESEARCH.md#bad-debt-analysis-socialized-loss-impact-on-vault-assets)** for:

- **Mechanism:** How socialization works and why share price drops silently
- **Detection signals:** Exchange rate monitoring, balance audits, user reports
- **Worked example:** $500k loss walkthrough with impact on users
- **Response options:** Silent acceptance, rebalance exit, user communication
- **Monitoring hooks:** Periodic polling and pre-rebalance audits

### Quick Detection Check

```bash
# Periodically sample (e.g., hourly):
RATE_NOW=$(stellar contract invoke --id $VAULT_CONTRACT_ID --network mainnet \
  -- get_exchange_rate)

RATE_LAST=$(cat .blend-rate-cache)

DELTA=$(( RATE_NOW - RATE_LAST ))

if (( DELTA < 0 )); then
  LOSS_PCT=$(( DELTA * 100 / RATE_LAST ))
  echo "Blend bad debt: $LOSS_PCT% loss detected"

  if (( LOSS_PCT < -200 )); then
    # > 2% loss: alert and consider rebalance exit
    echo "CRITICAL: Consider emergency_rebalance_exit()"
  fi
fi

echo "$RATE_NOW" > .blend-rate-cache
```

---

## 10. Ledger-to-Time Conversion Reference

Soroban does not expose wall-clock time natively. Use ledger sequence as a proxy.

| Duration | Approximate Ledger Count (5 s/ledger) |
| -------- | ------------------------------------- |
| 1 hour   | 720 ledgers                           |
| 6 hours  | 4 320 ledgers                         |
| 24 hours | 17 280 ledgers                        |
| 7 days   | 120 960 ledgers                       |
| 30 days  | 518 400 ledgers                       |

These are estimates. Use `env.ledger().sequence()` for precise comparisons in
contract code; cross-reference with Stellar Horizon for wall-clock mapping in
off-chain monitoring.
