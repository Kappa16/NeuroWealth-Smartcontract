# Architecture Documentation

This document describes the technical architecture of the NeuroWealth Vault contract, including storage layout, data structures, and integration patterns.

## Overview

The NeuroWealth Vault is a Soroban smart contract that implements a non-custodial yield vault on the Stellar blockchain. Users deposit USDC, and an AI agent automatically deploys those funds across various yield-generating protocols.

## Storage Layout

### Instance Storage

Instance storage is used for contract-wide configuration that is read frequently but changes infrequently.

| Key | Type | Description |
|-----|------|-------------|
| | `Agent` | Address | Authorized AI agent that can call rebalance() |
| | `UsdcToken` | Address | USDC token contract address |
| | `TotalDeposits` | i128 | Total USDC principal deposited (excluding yield) |
| | `TotalShares` | i128 | Total vault shares in circulation |
| | `TotalAssets` | i128 | Total managed assets (principal + yield) |
| | `CurrentProtocol`| Symbol | Active protocol symbol ("blend", "dex", "none") |
| | `BlendPool` | Address | Blend pool contract address |
| | `DexPool` | Address | DEX liquidity pool contract address (Issue #228) |
| | `Paused` | bool | Emergency pause state |
| | `Owner` | Address | Contract owner for administrative functions |
| | `PendingOwner` | Address | Pending owner for two-step transfer |
| | `TvLCap` | i128 | Maximum total value locked |
| | `UserDepositCap` | i128 | Maximum deposit per user |
| | `ApprovalTtl` | u32 | Shared ledger TTL used for Blend and DEX approvals (authoritative; `BlendApprovalTtl` retained for legacy fallback) |
| | `MinDeposit` | i128 | Minimum per-transaction deposit |
| | `MaxDeposit` | i128 | Maximum per-transaction deposit |
| | `MinRebalanceInterval` | u32 | Minimum ledgers between `rebalance()` calls; key absent = no cooldown (Issue #59) |
| | `LastRebalanceLedger` | u32 | Ledger of the most recent successful `rebalance()` (Issue #59) |
| | `PendingAgent` | Address | Agent awaiting timelock confirmation (Issue #317) |
| | `AgentTimelockExpiry` | u32 | Ledger at which the pending agent update becomes confirmable (Issue #317) |
| | `PendingUpgradeHash` | BytesN<32> | WASM hash awaiting timelock execution (Issue #316) |
| | `UpgradeTimelockExpiry` | u32 | Ledger at which the pending upgrade becomes executable (Issue #316) |
| | `Version` | u32 | Contract version for upgrade tracking |

### Persistent Storage

Persistent storage is used for per-user data that requires efficient access.

| Key | Type | Description |
|-----|------|-------------|
| | `Balance(Address)` | i128 | Deprecated. Retained only to preserve the serialized `DataKey` layout across upgrades; no longer read or written |
| | `Shares(Address)` | i128 | User's share balance (proportional ownership) |
| | `UserStrategy(Address)` | Symbol | Per-user strategy preference ("conservative", "balanced", "growth") |

### Storage Key Diagram: Instance vs Persistent

```
+-----------------------------------------------------------+
|                    NeuroWealth Vault                       |
+-----------------------------------------------------------+
| Contract-wide State (Instance Storage)                    |
| - Agent, UsdcToken, Owner, Paused                         |
| - TotalDeposits, TotalShares, TotalAssets                 |
| - TvLCap, UserDepositCap, MinDeposit, MaxDeposit          |
| - CurrentProtocol, BlendPool, DexPool                     |
| - ApprovalTtl, MinRebalanceInterval, LastRebalanceLedger  |
| - PendingAgent, AgentTimelockExpiry                       |
| - PendingUpgradeHash, UpgradeTimelockExpiry               |
| - Version                                                 |
+-----------------------------------------------------------+
           |                                       |
           | writes by: Owner, Agent, System        | writes by: User (on deposit/withdraw)
           | read by: Everyone                      | read by: User, Agent, Indexers
           | TTL: None (permanent)                  | TTL: Yes (Soroban rent)
           v                                       v
+-----------------------+                   +------------------+
|  Instance Storage     |                   | Persistent Storage|
|  (contract-wide)       |                   |  (per-user)       |
+-----------------------+                   +------------------+
| Agent(Address)         |                   | Shares(Address)   |
| TotalAssets(i128)      |                   | UserStrategy(Addr)|
| TotalShares(i128)      |                   | Balance(Address)  | <- deprecated
| TotalDeposits(i128)    |                   +------------------+
| ...                    |
+-----------------------+
```

**Access patterns:**

| Key | Category | Writers | Readers | TTL |
|-----|----------|---------|---------|-----|
| `Agent` | Instance | Owner (set_agent) | Everyone | None |
| `UsdcToken` | Instance | initialize only | Everyone | None |
| `TotalDeposits` | Instance | deposit/withdraw | Everyone | None |
| `TotalShares` | Instance | deposit/withdraw | Everyone | None |
| `TotalAssets` | Instance | deposit/withdraw, update_total_assets | Everyone | None |
| `CurrentProtocol` | Instance | rebalance | Everyone | None |
| `BlendPool` / `DexPool` | Instance | Owner (set_*_pool) | Everyone | None |
| `Paused` | Instance | Owner | Everyone | None |
| `Owner` / `PendingOwner` | Instance | Owner, accept_ownership | Everyone | None |
| `TvLCap` / dep caps / limits | Instance | Owner | Everyone | None |
| `MinRebalanceInterval` / `LastRebalanceLedger` | Instance | Owner, rebalance | Everyone | None |
| `PendingAgent` / `AgentTimelockExpiry` | Instance | update_agent, confirm/cancel | Everyone | None |
| `PendingUpgradeHash` / `UpgradeTimelockExpiry` | Instance | schedule_upgrade, execute/cancel | Everyone | None |
| `Version` | Instance | execute_upgrade | Everyone | None |
| `Shares(user)` | Persistent | deposit/withdraw | User, agent, indexers | Automatic on write; manual via touch_user_ttl() |
| `UserStrategy(user)` | Persistent | deposit (default), set_user_strategy | Agent (read for rebalance) | Automatic on write |
| `Balance(user)` | Persistent | None (deprecated) | None (deprecated) | N/A |

## Persistent Storage TTL Policy

Soroban persistent entries require rent (TTL). Expired `Shares` entries can be
archived and must be restored before use.

### Read-only getters (no TTL writes)

`get_balance` and `get_shares` only read storage. They do **not** call
`extend_ttl`, so RPC/indexer polling does not pay write costs or mutate ledger
state during simulation.

Implications for indexers and dashboards:

- High-frequency balance polling is safe and side-effect free.
- TTL for inactive users is **not** refreshed by read-only getters.
- Use `touch_user_ttl(user)` in a scheduled maintenance transaction when a user
  still has (or had) shares and you need to extend the `Shares` entry TTL without
  depositing or withdrawing.

### Explicit TTL maintenance

`touch_user_ttl(user)` extends the `Shares(user)` persistent entry when it
exists, using threshold **100** ledgers and extend-to **100** ledgers (same
parameters previously applied inside the read getters).

Returns `false` when no `Shares` entry exists (never deposited, or entry already
expired and removed).

### State-changing paths

`deposit`, `withdraw`, and `withdraw_all` update `Shares(user)` via `set`, which
refreshes TTL as part of normal writes. Routine user activity keeps share data
alive without calling `touch_user_ttl`.

## DataKey Structure

```rust
pub enum DataKey {
    Balance(Address),      // user -> usdc principal
    Shares(Address),       // user -> share balance
    TotalDeposits,        // total principal in vault
    TotalShares,          // total shares in circulation
    TotalAssets,          // total managed assets (principal + yield)
    Agent,                // authorized AI agent address
    UsdcToken,            // USDC token contract address
    Paused,               // emergency pause state
    Owner,                // contract owner address
    PendingOwner,         // pending owner for two-step transfer
    TvLCap,               // maximum TVL
    UserDepositCap,       // per-user deposit limit
    ApprovalTtl,          // shared protocol approval lifetime
    MinDeposit,           // minimum transaction amount
    MaxDeposit,           // maximum transaction amount
    Version,              // contract version
    BlendPool,            // Blend pool contract address
    DexPool,              // DEX liquidity pool contract address (#228)
    CurrentProtocol,      // symbol of active protocol ("blend" | "dex" | "none")
    UserStrategy(Address),// user -> strategy preference symbol
    MinRebalanceInterval, // rebalance cooldown in ledgers (#59)
    LastRebalanceLedger,  // ledger of last successful rebalance (#59)
    PendingAgent,         // agent awaiting timelock confirmation (#317)
    AgentTimelockExpiry,  // ledger the pending agent update unlocks at (#317)
    PendingUpgradeHash,   // WASM hash awaiting timelock execution (#316)
    UpgradeTimelockExpiry,// ledger the pending upgrade unlocks at (#316)
    Deployer,             // deployer address (init only)
}
```

## Share Accounting Model

The vault uses a share-based accounting model compatible with the ERC-4626 standard. Each depositor receives vault shares proportional to their contribution at the time of deposit. As yield accrues and `TotalAssets` grows relative to `TotalShares`, each share appreciates in value — meaning later redeemers receive more USDC per share than they originally paid.

### Share Pricing

```
exchange_rate = TotalAssets / TotalShares          (assets per share)

shares_minted = (deposit_amount × TotalShares) / TotalAssets
assets_out    = (shares_burned × TotalAssets)  / TotalShares
```

The on-chain getter `get_exchange_rate()` returns `TotalAssets × 10_000_000 / TotalShares` (7-decimal fixed-point) to avoid fractional values.

### Overflow Safety

All share↔asset conversions use checked arithmetic:

```rust
// assets → shares (deposit, floor division)
shares = (assets * total_shares) / total_assets   // checked_mul

// shares → assets (withdraw, floor division)  
assets = (shares * total_assets) / total_shares   // checked_mul

// exchange rate (7-decimal fixed point)
rate = (total_assets * 10_000_000) / total_shares // checked_mul
```

**Maximum safe input before overflow depends on the current totals:**

- For `convert_to_shares`: `assets` must be ≤ `i128::MAX / total_shares` to avoid overflow in the `assets * total_shares` product. With a 100M USDC TVL cap and typical share counts, the practical deposit limit is far below this boundary, but the checked multiply ensures safety regardless of future configuration changes.
- For `convert_to_assets`: `shares` must be ≤ `i128::MAX / total_assets` to avoid overflow in the `shares * total_assets` product.

Current defaults (100M TVL cap) keep both products safely under `i128::MAX` for all realistic inputs. The checked operations ensure the contract reverts with an explicit error rather than silently wrapping if a configuration or environment change ever pushes these boundaries.

Tests in `tests/test_checked_arithmetic.rs` verify the overflow guard at `i128::MAX`.

### Yield Accrual via update_total_assets

The AI agent calls `update_total_assets(new_total)` to report yield earned in external protocols (e.g. Blend). This increases `TotalAssets` without changing `TotalShares`, which raises the share price for all holders. The update is bounded: a single call cannot decrease `TotalAssets` below the current value, and cannot increase it beyond a configurable maximum basis-point delta, preventing the agent from inflating balances arbitrarily.

### Blend Deployment

When the agent calls `rebalance(protocol="blend", ...)` the vault:

1. Approves the Blend pool to pull vault USDC (short-lived TTL approval stored in the shared `ApprovalTtl` key).
2. Calls `blend_pool.submit_with_allowance()` to supply USDC as a lender.
3. Records `CurrentProtocol = "blend"`.

On withdrawal, if the vault's idle balance is insufficient, it calls `blend_pool.submit()` to withdraw the required amount before transferring to the user.

### Historical: Phase 1 (1:1 accounting — deprecated)

Prior to the ERC-4626 model, the vault used simple 1:1 balance accounting: 1 deposited USDC = 1 vault balance unit, with no share concept. This approach could not track proportional yield and has been fully replaced. The `Balance(Address)` key is retained only for legacy migration paths and is no longer the authoritative ownership record — `Shares(Address)` is.

### Current Implementation (Share-Based)

The vault converts between USDC assets and vault shares using the current exchange rate:

```
shares = (assets * total_shares) / total_assets
assets = (shares * total_assets) / total_shares
```

**Key Features**:
- **Proportional Yield**: Users benefit from yield accrual as the `TotalAssets` increases relative to `TotalShares`.
- **Atomic Conversions**: Deposits mint shares and withdrawals burn shares based on the real-time asset/share ratio.
- **ERC-4626 Compatibility**: Implements standard preview and conversion functions.
- **Overflow Protection**: All intermediate products use `checked_mul` to prevent i128 overflow, with explicit panic messages.

## Rounding Rules

To protect the vault's solvency and prevent "dust" attacks, rounding rules are strictly applied:

- **Deposits**: 
    - `preview_deposit_to_shares`: Rounds **down** (user may receive slightly fewer shares).
- **Withdrawals**:
    - `withdraw(assets)`: Rounds **up** when calculating shares to burn (user burns slightly more shares to cover the asset amount).
    - `preview_withdraw(assets)`: Rounds **up** to match actual behavior.
- **Conversions**:
    - `convert_to_assets`: Rounds **down**.
    - `convert_to_shares`: Rounds **down**.

## Event Schema

### DepositEvent

```rust
struct DepositEvent {
    user: Address,    // User who made the deposit
    amount: i128,     // Amount in 7-decimal USDC units
    shares: i128,     // Number of shares minted
}
```

**Topics**: `SymbolShort("deposit")`

### WithdrawEvent

```rust
struct WithdrawEvent {
    user: Address,    // User who made the withdrawal
    amount: i128,     // Amount in 7-decimal USDC units
    shares: i128,     // Number of shares burned
}
```

**Topics**: `SymbolShort("withdraw")`

### RebalanceEvent

```rust
pub struct RebalanceEvent {
    pub protocol: Symbol,           // Target protocol ("blend", "none")
    pub expected_apy: i128,         // Expected APY in basis points (850 = 8.5%)
    pub status: Symbol,             // Status ("success", "failed", "partial", "noop")
    pub amount_attempted: i128,     // Amount attempted to be moved
    pub amount_moved: i128,          // Amount actually moved
    pub amount_supplied: i128,      // Amount supplied into the target protocol
    pub amount_withdrawn: i128,     // Amount withdrawn from the prior protocol
}
```

**Topics**: `SymbolShort("rebalance")`

### PauseEvent

```rust
struct PauseEvent {
    paused: bool,    // true = paused, false = unpaused
    caller: Address, // Who triggered the pause
}
```

**Topics**: `SymbolShort("pause")`

### TvlCapUpdatedEvent

```rust
pub struct TvlCapUpdatedEvent {
    pub old_cap: i128,
    pub new_cap: i128,
}
```

**Topics**: `SymbolShort("tvl_cap")`

### UserDepositCapUpdatedEvent

```rust
pub struct UserDepositCapUpdatedEvent {
    pub old_cap: i128,
    pub new_cap: i128,
}
```

**Topics**: `SymbolShort("user_cap")`

### CapsUpdatedEvent

```rust
pub struct CapsUpdatedEvent {
    pub old_user_cap: i128,
    pub new_user_cap: i128,
    pub old_tvl_cap: i128,
    pub new_tvl_cap: i128,
}
```

**Topics**: `SymbolShort("caps_upd")`

## Cross-Contract Integration Flow

### USDC Token Integration

```
Vault Contract → USDC Token Contract (via token::Client)
                  ↑
                  ├── transfer() - receive user funds
                  └── transfer() - return funds to user
```

**Integration Points**:
1. `deposit()`: Calls `token.transfer(user, vault, amount)`
2. `withdraw()`: Calls `token.transfer(vault, user, amount)`

**Assumptions**:
- USDC uses Stellar's Soroban Token interface
- 7 decimal places
- Standard token operations (transfer, balance, etc.)

### AI Agent Integration

```
AI Agent → Vault Contract
            ├── get_balance(user) - monitor positions (read-only, no TTL write)
            ├── get_shares(user) - monitor share balances (read-only)
            ├── touch_user_ttl(user) - optional TTL maintenance for idle users
            ├── get_total_deposits() - monitor TVL
            └── rebalance(strategy) - signal strategy changes
            ↓
     DepositEvent / WithdrawEvent (via Soroban events)
```

**Event Flow**:
1. User calls `deposit()` or `withdraw()`
2. Contract emits corresponding event
3. AI agent monitors events via RPC/subscription
4. Agent responds by calling `rebalance()` or adjusting off-chain state

Rotating the agent address is not instant — it goes through a 24-hour timelock.
See [Agent Update Timelock (Issue #317)](#agent-update-timelock-issue-317).

### Blend Protocol Integration

```
Vault Contract → Blend Protocol Contract
                 ↑
                 ├── submit_with_allowance() - lend USDC for yield
                 ├── submit() - withdraw from lending
                 └── balance() - check yield earned
```

The vault integrates with the Blend protocol to generate yield on deposited USDC. The AI agent triggers rebalancing to move funds into or out of Blend.

### DEX Liquidity Pool Integration (Issue #228)

```
Vault Contract → DEX Liquidity Pool Contract
                 ↑
                 ├── add_liquidity(from, asset, amount, min_out)    - provide USDC liquidity
                 ├── remove_liquidity(to, asset, amount, min_out)   - withdraw liquidity
                 └── balance(asset, user)                           - current position size
```

Alongside Blend lending, the vault can deploy idle USDC as single-asset
liquidity into a Stellar DEX pool. This backs the Balanced and Growth
strategies described in the README. The two integrations are mutually exclusive
at any point in time: `CurrentProtocol` names at most one of `"blend"`,
`"dex"`, or `"none"`.

See [`docs/DEX_INTEGRATION.md`](docs/DEX_INTEGRATION.md) for the full interface
research and rationale.

#### Storage

| Key | Storage | Type | Description |
|-----|---------|------|-------------|
| | `DataKey::DexPool` | Instance | Address | DEX liquidity pool contract address. Absent until `set_dex_pool` is called; any rebalance targeting `"dex"` panics with `DexPoolNotConfigured` while unset. |
| | `DataKey::CurrentProtocol` | Instance | Symbol | Set to `"dex"` once a supply leg succeeds. Shared with the Blend path — the vault is never deployed to both at once. |
| | `DataKey::ApprovalTtl` | Instance | u32 | Shared with Blend. Each supply leg approves the DEX pool to spend USDC until `current_ledger + ApprovalTtl`. |

`set_dex_pool(owner, pool_address)` is owner-only and probes the candidate
pool's `balance` entrypoint before storing the address, so a wrong or
non-conforming address is rejected at configuration time rather than at the
next rebalance. It initializes `CurrentProtocol` to `"none"` when unset and
emits `DexPoolConfiguredEvent`. There is no separate `DexApprovalTtl` key:
`set_approval_ttl` governs both integrations.

#### DexPoolClient interface

`DexPoolClient` is an internal adapter mirroring `BlendPoolClient`. It treats
the pool as a single-asset venue and derives actual amounts from the **vault's
own USDC balance delta** rather than trusting the pool's return value, so
partial fills and slippage are observable on-chain.

| Method | Pool call | Returns |
|--------|-----------|---------|
| | `supply(pool, asset, amount, min_out, to)` | `add_liquidity(from, asset, amount, min_out)` | `balance_before - balance_after` (USDC actually supplied) |
| | `withdraw(pool, asset, amount, min_out, to)` | `remove_liquidity(to, asset, amount, min_out)` | `balance_after - balance_before` (USDC actually received) |
| | `get_balance(pool, asset, user)` | `balance(asset, user)` | The vault's current liquidity position |

`min_out` is forwarded to the pool for its own slippage check, and the realized
delta is re-checked locally by `require_min_out`, which panics with
`MinOutNotMet` when `min_out > 0` and the leg came up short.

#### Idle vs deployed tracking with DEX positions

DEX positions participate in the same idle/deployed split described under
[Idle vs Deployed Asset Tracking](#idle-vs-deployed-asset-tracking-issue-321):

- `get_idle_balance()` reads the vault's own USDC token balance and is
  protocol-agnostic — supplying liquidity moves value out of it.
- `get_deployed_assets()` dispatches on `CurrentProtocol`. When it is `"dex"`,
  the figure comes from a live `balance(asset, vault)` call on the configured
  DEX pool.
- If `CurrentProtocol` is `"dex"` but `DexPool` is unset, `get_deployed_assets()`
  returns `0` rather than panicking. The read path tolerates an unconfigured
  pool; the write path (`rebalance`) does not.
- `get_asset_breakdown()` returns both figures from a single invocation, so
  they cannot straddle a rebalance.

Because `get_deployed_assets()` performs a cross-contract call, it costs
materially more than a plain storage getter — roughly the same order as the
Blend balance read in the resource table above.

#### Rebalance flow for DEX deployments

`rebalance("dex", expected_apy, min_out)` runs the same sequence as the Blend
path:

1. Guards: agent auth, not paused, `0 ≤ expected_apy ≤ 10 000`, `min_out ≥ 0`,
   protocol in the `{"blend", "dex", "none"}` allowlist, and the rebalance
   cooldown (`MinRebalanceInterval`) has elapsed.
2. **Exit leg.** If `CurrentProtocol` is a different non-`"none"` protocol, the
   vault fully exits it first. If a non-zero balance remains after the
   withdrawal, `RebalanceFailedEvent` is emitted and the call **returns without
   further state changes** — the transaction is not reverted, so the failure is
   observable on-chain (Issue #145).
3. Panic with `DexPoolNotConfigured` if `DataKey::DexPool` is unset.
4. **Supply leg.** The entire idle USDC balance is supplied: the vault approves
   the pool for `amount` until `current_ledger + ApprovalTtl`, authorizes the
   nested `add_liquidity` → `transfer_from` invocation via
   `authorize_as_current_contract`, then calls the pool. `CurrentProtocol` is
   set to `"dex"` only when the realized amount is positive.
5. **Noop case.** With zero idle USDC and nothing moved, `CurrentProtocol` is
   still set to `"dex"` so tracking matches intent, and the rebalance reports
   status `"noop"` (mirrors Blend, Issue #146).
6. `RebalanceEvent` is emitted with status `"success"`, `"partial"` (realized
   below the attempted amount), `"failed"` (realized zero), or `"noop"`.

Withdrawals follow the reverse path: `withdraw_from_dex(amount, min_out)` pulls
from the pool when idle USDC cannot cover a redemption, treating `amount == 0`
as "withdraw the entire position".

#### DEX-specific events

| Event | Topic | Emitted by | Payload |
|-------|-------|------------|---------|
| | `DexSupplyEvent` | `"dex_sup"` (`TOPIC_DEX_SUPPLY`) | supply leg of `rebalance("dex", ..)` | `asset`, `amount_actual` (balance-delta measured), `success` |
| | `DexWithdrawEvent` | `"dex_wd"` (`TOPIC_DEX_WITHDRAW`) | DEX exit leg of `rebalance` or a user redemption | `asset`, `amount_actual`, `success` |
| | `DexPoolConfiguredEvent` | `"dex_cfg"` (`TOPIC_DEX_POOL_CONFIGURED`) | `set_dex_pool` | `old_pool` (`None` on first configuration), `new_pool`, `owner` |

These are emitted **in addition to** the protocol-agnostic `RebalanceEvent` and
`ProtocolChangedEvent`. Indexers tracking which venue the vault is deployed to
should treat `ProtocolChangedEvent` as authoritative rather than inferring it
from supply/withdraw events. See [EVENTS.md](EVENTS.md) for payload field
descriptions.

## Asset Flow Diagrams

### Deposit Flow

1. User authorizes deposit transaction.
2. USDC transferred from user to vault.
3. Vault calculates shares to mint based on current `TotalAssets` and `TotalShares`.
4. User share balance updated in persistent storage.
5. `TotalAssets` and `TotalShares` updated in instance storage.
6. `DepositEvent` emitted.

### Withdraw Flow

1. User authorizes withdrawal transaction.
2. Vault calculates shares to burn (rounding up to protect vault).
3. If vault balance is insufficient, funds are withdrawn from active protocols (e.g., Blend).
4. User share balance updated in persistent storage.
5. `TotalAssets` and `TotalShares` updated in instance storage.
6. USDC transferred from vault to user.
7. `WithdrawEvent` emitted.

### Rebalance Flow (AI Agent)

1. AI agent evaluates market conditions.
2. Agent calls `rebalance(protocol, expected_apy, min_out)` on vault.
3. Vault verifies caller is agent, protocol is in `{"blend", "dex", "none"}`,
   and the `MinRebalanceInterval` cooldown has elapsed.
4. If already deployed elsewhere, vault exits the current protocol first. An
   incomplete exit emits `RebalanceFailedEvent` and aborts without further
   state changes.
5. Vault executes on-chain movement (supply to or withdraw from Blend or the
   DEX pool), emitting the protocol-specific supply/withdraw event.
6. `ProtocolChangedEvent` emitted if `CurrentProtocol` changed.
7. `RebalanceEvent` emitted with the outcome status.

## Upgrade Model

### Storage Preservation

When upgrading the contract, the following storage keys must be preserved:

- `Shares(Address)` and `Balance(Address)`
- `TotalDeposits`, `TotalShares`, `TotalAssets`
- `Agent`, `UsdcToken`, `Owner`, `Paused`
- `TvLCap`, `UserDepositCap`, `ApprovalTtl`, `MinDeposit`, `MaxDeposit`
- `BlendPool`, `DexPool`, `CurrentProtocol`
- `UserStrategy(Address)`
- `MinRebalanceInterval`, `LastRebalanceLedger`
- `PendingAgent`, `AgentTimelockExpiry` (if an agent update is mid-flight)
- `Version` (incremented by `execute_upgrade`)

`PendingUpgradeHash` and `UpgradeTimelockExpiry` are deliberately **not**
preserved: `execute_upgrade` clears them before applying the new WASM, so the
upgraded contract starts with no proposal pending.

### Version History

| Version | Changes | Status |
|---------|---------|--------|
| | 1 | Initial 1:1 balance accounting (no shares) | Historical — superseded |
| | 2 | ERC-4626 share accounting, Blend integration, rounding rules | **Current** |
| | 3 | (Planned) Multi-asset support and advanced rebalancing | Future |

`Version` is incremented by `execute_upgrade`, not by `schedule_upgrade`.
Scheduling an upgrade that is later cancelled leaves `Version` untouched, so
`get_version()` always reflects the WASM actually running.

## Error Handling

Errors are surfaced as typed `VaultError` contract errors rather than raw panic
strings. See [ERROR_STYLE_GUIDE.md](ERROR_STYLE_GUIDE.md) for the full code
table and wording conventions.

### Key error codes by function

| Function | VaultError variant (code) | Condition |
|----------|--------------------------|-----------|
| | `initialize` | `AlreadyInitialized` (#4) | Called more than once |
| | `deposit` | `Paused` (#35) | Vault is paused |
| | `deposit` | `AmountMustBePositive` (#37) | amount ≤ 0 |
| | `deposit` | `BelowMinimumDeposit` (#38) | amount < min_deposit |
| | `deposit` | `ExceedsUserDepositCap` (#40) | user cumulative > cap |
| | `deposit` | `ExceedsTvlCap` (#41) | total_assets + amount > tvl_cap |
| | `withdraw` | `Paused` (#35) | Vault is paused |
| | `withdraw` | `AmountMustBePositive` (#37) | amount ≤ 0 |
| | `withdraw` | `InsufficientShares` (#8) | shares to burn > user shares |
| | `rebalance` | `Paused` (#35) | Vault is paused |
| | `unpause` | `NotPaused` (#21) | Called when not paused |

### Return Values

All read functions return the requested data or 0/default if not set.

## Testing Considerations

### Unit Tests

- Deposit with valid amount
- Deposit with minimum amount (boundary)
- Deposit exceeding cap (should fail)
- Withdraw with sufficient balance
- Withdraw exceeding balance (should fail)
- Pause/unpause by owner
- Pause by non-owner (should fail)

### Integration Tests

- Full deposit → rebalance → withdraw flow
- Multiple users depositing and withdrawing
- TVL cap enforcement
- User deposit cap enforcement
- Emergency pause during active deposits

## Gas Considerations

### Instance Storage Operations

- Read: ~1-2 gas units
- Write: ~2-3 gas units
- Use for: Configuration, totals, flags

### Persistent Storage Operations

- Read: ~1 gas unit
- Write: ~1-2 gas units
- Use for: User balances

### Optimization Strategies

1. Batch reads when possible
2. Use instance storage for frequently accessed globals
3. Use persistent storage for user-specific data

## Ledger Resource Baselines (Issue #203)

Measured in the Soroban simulator against `soroban-env-host 21.2.1` with the
MockBlendPool and TestToken test helpers.  Upper bounds used as soft regression
gates in `tests/test_budget.rs`.

| Operation | CPU instructions | Memory bytes |
|-----------|------------------|--------------|
| | `deposit` | < 5 000 000 | < 300 000 |
| | `withdraw` (no Blend) | < 5 000 000 | < 300 000 |
| | `withdraw` (Blend pull) | < 15 000 000 | < 600 000 |
| | `rebalance → blend` | < 15 000 000 | < 600 000 |
| | `rebalance → none` | < 15 000 000 | < 600 000 |

Cross-contract operations (Blend supply/withdraw) cost roughly 3× a simple
deposit because each `invoke_contract` carries its own CPU and memory overhead.

## Idle vs Deployed Asset Tracking (Issue #321)

The vault distinguishes between two components of its total managed value:

| Component | Getter | Description |
|-----------|--------|-------------|
| | **Idle** | `get_idle_balance()` | USDC held directly in the vault contract, not yet deployed to any protocol. |
| | **Deployed** | `get_deployed_assets()` | USDC currently supplied to an external yield protocol (e.g., Blend, DEX). |

Both values are also available in a single atomic call via `get_asset_breakdown()`, which returns `(idle, deployed)` — useful for dashboards and AI agents that need both figures without two separate RPC round-trips.

### How idle balance changes

- **Increases** on `deposit()` (user transfers USDC into the vault).
- **Decreases** on `rebalance()` when the agent supplies idle USDC to a protocol.
- **Increases** on `rebalance()` or `withdraw()` when funds are pulled back from a protocol.

### How deployed assets change

- **Increases** after a successful `rebalance()` into Blend or the DEX.
- **Decreases** after `rebalance()` to `"none"` (full protocol exit) or after
  partial/full protocol withdrawals triggered by user redemptions.
- Returns `0` when `CurrentProtocol` is `"none"` — no funds are deployed.

### Relationship to TotalAssets

`idle + deployed` may differ from `TotalAssets`.  `TotalAssets` is the
authoritative accounting value used for share pricing and includes accrued yield
as reported by the agent via `update_total_assets()`.  The live balance getters
query on-chain token balances directly and therefore represent the current
on-chain state before any yield reporting adjustment.

## TotalDeposits vs TotalAssets Relationship (Issues #183, #299)

Two separate values track vault accounting:

| Field | Updated by | Includes yield? | Used for |
|-------|------------|-----------------|----------|
| | `TotalDeposits` | `deposit`, `withdraw` | No | Principal bookkeeping, reporting only |
| | `TotalAssets` | `deposit`, `withdraw`, `update_total_assets` | Yes | Share pricing, TVL cap guard, all economic math |

**Design decision (issue #299):** `TotalDeposits` is intentionally *not* synced
when `update_total_assets()` is called.  It is a principal-only counter.
`TotalAssets` is the authoritative value for all economic calculations and cap
enforcement.

**TVL cap check uses `TotalAssets`**: after yield accrual `TotalAssets` can
exceed `TotalDeposits`.  The cap must compare against `TotalAssets` to prevent
additional deposits from pushing total managed value past the intended limit.
Checking `TotalDeposits` instead would allow over-subscription once yield has
grown the vault past the cap.

**Share pricing**: `share_price = TotalAssets / TotalShares`.  All economic
quantities (user balance, redemption amount) derive from `TotalAssets`, not
`TotalDeposits`.

**Regression tests**: `tests/test_total_assets_cap.rs` covers the full lifecycle:
deposit → yield accrual → withdrawal → cap check, confirming that `TotalAssets`
diverges from `TotalDeposits` after yield and that cap guards remain correct.

## expected_apy Validation (Issue #185)

`rebalance(protocol, expected_apy)` validates `0 ≤ expected_apy ≤ 10 000`
(basis points, where 10 000 = 100 %).  Values outside this range are rejected
with `vault: expected_apy out of range (0-10000 bps)`.

The field is **informational for indexers** — it is emitted in `RebalanceEvent`
but does not influence on-chain fund movement.  Off-chain consumers (AI agent,
dashboards) use it to audit that the expected yield reported at rebalance time
is plausible.

## Agent Update Timelock (Issue #317)

The agent address is the only key allowed to call `rebalance()`, so replacing it
hands control of fund movement to a new keypair. Rotating the agent therefore
requires two transactions separated by a mandatory delay, giving users and
monitoring systems a window to observe the pending rotation and react before it
takes effect.

```
update_agent(new_agent)                confirm_agent_update()
        │                                       │
        ▼                                       ▼
   [ pending ] ───── AGENT_TIMELOCK_LEDGERS ──▶ [ applied ]
        │               (17,280 ≈ 24 h)
        │
        └── cancel_agent_update() ──▶ [ cleared ]
```

### Flow

| Function | Auth | Effect |
|----------|------|--------|
| | `update_agent(new_agent)` | owner | Records `PendingAgent` and sets `AgentTimelockExpiry = current_ledger + AGENT_TIMELOCK_LEDGERS`. The active `Agent` is **unchanged**. Emits `AgentUpdateProposedEvent`. |
| | `confirm_agent_update()` | owner | Requires `current_ledger >= AgentTimelockExpiry`. Writes `PendingAgent` into `Agent` and clears both pending keys. Emits `AgentUpdateConfirmedEvent` **and** `AgentUpdatedEvent`. |
| | `cancel_agent_update()` | owner | Clears both pending keys so a new proposal can be made. Emits `AgentUpdateCancelledEvent`. |
| | `get_pending_agent_update()` | none (read-only) | Returns `Some((pending_agent, effective_ledger))` while a proposal is pending, else `None`. |

`update_agent()` is the propose step only — it is deliberately *not* an instant
setter. Until `confirm_agent_update()` succeeds, `get_agent()` still returns the
old address and only the old agent can call `rebalance()`.

**Constant:** `AGENT_TIMELOCK_LEDGERS = 17_280` ledgers. At Stellar's ~5 s per
ledger that is ≈ 86,400 s = 24 hours. It matches `UPGRADE_TIMELOCK_LEDGERS` so
both privileged-role changes share one recovery window.

### Storage keys

Both live in instance storage and are cleared on confirm *and* on cancel.

| Key | Type | Description |
|-----|------|-------------|
| | `DataKey::PendingAgent` | `Address` | Proposed agent awaiting confirmation. Its presence is what makes an update "pending". |
| | `DataKey::AgentTimelockExpiry` | `u32` | First ledger sequence at which `confirm_agent_update()` may be called. |

### Events

| Event | Topic | Payload |
|-------|-------|---------|
| | `AgentUpdateProposedEvent` | `"agt_prop"` | `old_agent`, `new_agent`, `effective_ledger` |
| | `AgentUpdateConfirmedEvent` | `"agt_conf"` | `old_agent`, `new_agent` |
| | `AgentUpdateCancelledEvent` | `"agt_cncl"` | `old_agent`, `proposed_new_agent` |

`confirm_agent_update()` additionally re-emits the pre-timelock
`AgentUpdatedEvent` (`"agent"`) so indexers that already track that topic see
the rotation without changes. See [EVENTS.md](EVENTS.md) for payload field
descriptions.

### Security rationale

An owner key compromise is the highest-impact failure mode for the vault: the
agent controls where deposited USDC is deployed. Without a delay, an attacker
holding the owner key could swap in an attacker-controlled agent and immediately
rebalance funds into a hostile "protocol" in a single transaction — no observer
would have time to react.

The timelock converts that into a 24-hour detectable event:

- The proposal is public on-chain the moment it is made
  (`AgentUpdateProposedEvent` carries the target address and the exact ledger at
  which it unlocks), so monitoring can alert on it.
- During the window the legitimate owner — or a recovered multisig quorum — can
  call `cancel_agent_update()` to void the proposal, and can `pause()` the vault
  to freeze `rebalance()` entirely while the incident is handled.
- Because only one proposal may be pending at a time, an attacker cannot spam
  proposals to bury the real one; changing the target requires cancelling first,
  which restarts the full 24-hour clock.

### Invariants

- Only one proposal may be pending at a time. Calling `update_agent()` while
  `PendingAgent` exists panics with `TimelockAlreadyPending`.
- `confirm_agent_update()` or `cancel_agent_update()` with no proposal panics
  with `NoTimelockPending`; confirming before the expiry ledger panics with
  `TimelockNotExpired`.
- `TimelockAlreadyPending`, `NoTimelockPending`, and `TimelockNotExpired` are
  shared with the upgrade timelock (Issue #316) because `#[contracterror]` caps
  the enum at 50 variants.
- All three entrypoints require owner auth. A pending proposal grants the
  proposed agent no privileges whatsoever until confirmation.
- `cancel_agent_update()` is not pause-gated, so the escape hatch stays
  available while the vault is paused.

Coverage lives in
`neurowealth-vault/contracts/vault/src/tests/test_agent_timelock.rs`.

## Upgrade Safety (Issues #189, #316)

Contract upgrades are protected by two independent guards: a pause guard
(Issue #189) and a two-step timelock (Issue #316).

### Pause guard (Issue #189)

`schedule_upgrade()` and `execute_upgrade()` are both gated by
`require_not_paused()`. During an incident the operator pauses the vault to
freeze user operations; the upgrade guard ensures that a compromised or
mistaken WASM upgrade cannot be pushed while the vault is in a degraded state.
To upgrade: unpause → schedule → wait out the timelock → execute → re-pause if
needed.

`cancel_upgrade()` is deliberately **not** pause-gated, so the escape hatch
stays available even while the vault is paused.

### Two-step timelocked upgrade (Issue #316)

The instant `upgrade(new_wasm_hash)` entrypoint has been removed. Replacing the
contract's WASM now requires two transactions separated by a mandatory delay,
which gives users and monitoring systems a window to observe a pending code
change and react to a malicious or mistaken proposal before it takes effect.

```
schedule_upgrade(owner, hash)          execute_upgrade(owner)
        │                                       │
        ▼                                       ▼
   [ pending ] ──── UPGRADE_TIMELOCK_LEDGERS ──▶ [ applied ]
        │              (17,280 ≈ 24 h)
        │
        └── cancel_upgrade(owner) ──▶ [ cleared ]
```

| Function | Auth | Effect |
|----------|------|--------|
| | `schedule_upgrade(owner, new_wasm_hash)` | owner, not paused | Records `PendingUpgradeHash` and sets `UpgradeTimelockExpiry = current_ledger + UPGRADE_TIMELOCK_LEDGERS`. Emits `UpgradeScheduledEvent`. |
| | `execute_upgrade(owner)` | owner, not paused | Requires `current_ledger >= UpgradeTimelockExpiry`. Clears both keys, applies the WASM, increments `Version`. Emits `UpgradedEvent`. |
| | `cancel_upgrade(owner)` | owner | Clears both keys so a new proposal can be scheduled. Emits `UpgradeCancelledEvent`. |
| | `get_pending_upgrade()` | none (read-only) | Returns `Some((wasm_hash, effective_ledger))` while a proposal is pending, else `None`. |

**Constant:** `UPGRADE_TIMELOCK_LEDGERS = 17_280` ledgers. At Stellar's ~5 s
per ledger that is ≈ 86,400 s = 24 hours. It matches `AGENT_TIMELOCK_LEDGERS`
so both privileged-role changes share one recovery window.

**Storage keys** (instance storage, both cleared on execute *and* on cancel):

| Key | Type | Description |
|-----|------|-------------|
| | `DataKey::PendingUpgradeHash` | `BytesN<32>` | WASM hash awaiting execution. Its presence is what makes an upgrade "pending". |
| | `DataKey::UpgradeTimelockExpiry` | `u32` | First ledger sequence at which `execute_upgrade()` may be called. |

**Events:** `UpgradeScheduledEvent` (`"upg_sched"`), `UpgradeCancelledEvent`
(`"upg_cncl"`), and `UpgradedEvent` (`"upgraded"`, now emitted by
`execute_upgrade` rather than the removed instant path). See
[EVENTS.md](EVENTS.md) for payload fields.

**Invariants:**

- Only one proposal may be pending at a time. Scheduling while
  `PendingUpgradeHash` exists panics with `TimelockAlreadyPending`; to change
  the target hash, cancel first and re-schedule (restarting the 24-hour clock).
- `execute_upgrade()` with no proposal panics with `NoTimelockPending`; before
  the expiry ledger it panics with `TimelockNotExpired`.
- `TimelockAlreadyPending`, `NoTimelockPending`, and `TimelockNotExpired` are
  shared with the agent timelock (Issue #317) because `#[contracterror]` caps
  the enum at 50 variants.
- The pending keys are cleared *before* `update_current_contract_wasm` is
  called, so a fresh proposal can always be scheduled after execution.
- A pending proposal has no effect on the running code. Until
  `execute_upgrade()` succeeds, the deployed WASM is unchanged.

Operational runbooks for scheduling, monitoring, and executing an upgrade live
in [docs/UPGRADE_MIGRATION.md](docs/UPGRADE_MIGRATION.md).
4. Minimize state changes in single transaction

## Stale-State & Checks-Effects-Interactions Audit (Issue #568)

To prevent stale-state vulnerabilities where storage reads performed after cross-contract calls observe externally influenced or unexpected state, all hot paths strictly follow the **Checks-Effects-Interactions (CEI)** pattern. Storage state reads and updates precede external interactions whenever feasible.

### Hot-Path Per-Function Review Notes

#### 1. `deposit` & `batch_deposit`
- **Audit Findings**: Previously, `token_client.transfer(...)` was called before calculating state updates (`TotalDeposits`, `TotalShares`, `TotalAssets`, `Shares(user)`, `UserStrategy`).
- **Resolution**: Re-structured so all contract checks, storage reads, share-minting math, and storage writes (`TotalDeposits`, `Shares`, `TotalShares`, `TotalAssets`, `UserStrategy`, `UserSharesIndex`) take place **before** initiating the external USDC token transfer call. No storage reads occur after the cross-contract `transfer`.

#### 2. `withdraw` & `withdraw_all`
- **Audit Findings**: If idle vault balance was lower than requested, `withdraw_amount_from_protocol(...)` called external protocol contracts (Blend/DEX) before validating `Shares(user)`, `TotalShares`, and `TotalAssets`. An unauthorized user or invalid withdrawal could cause unnecessary external protocol interactions before failing.
- **Resolution**: User share balances (`Shares(user)`), `TotalShares`, and `TotalAssets` are now read and validated upfront before any external protocol withdrawal call. If a protocol withdrawal is required, reconciled share burn calculations use the pre-read snapshot totals (`convert_to_shares_internal_ceil_with_totals`), ensuring no storage reads take place after protocol interactions.

#### 3. `rebalance`
- **Audit Findings**: Pre-reads all configuration and timing parameters (`ApprovalTtl`, `BlendPool`, `DexPool`, `MinRebalanceInterval`, `LastRebalanceLedger`) before triggering protocol exit or supply legs.
- **Resolution**: All storage parameters required for authorization and leg setup are read prior to invoking external protocol contracts (`submit_with_allowance`, `add_liquidity`, `remove_liquidity`).

#### 4. `update_total_assets`
- **Audit Findings**: The contract previously read `CurrentProtocol`, `BlendPool`, and `DexPool` keys intermittently between balance queries.
- **Resolution**: All storage keys (`Agent`, `TotalAssets`, `UsdcToken`, `CurrentProtocol`, `BlendPool`, `DexPool`) are read upfront prior to executing cross-contract balance calls (`token_client.balance`, `BlendPoolClient::get_balance`, `DexPoolClient::get_balance`). Following external calls, only the invariant check (`total_available >= new_total`) and storage write (`TotalAssets`) execute.

### Automated Verification
A grep-based CI check script ([`scripts/check-stale-state-audit.sh`](file:///c:/Users/user/OneDrive/Documents/Open-source/NeuroWealth-Smartcontract/scripts/check-stale-state-audit.sh)) enforces these invariants on every PR.

## Cross-Contract Call Surface & Failure-Mode Analysis (Issue #566)

The `NeuroWealthVault` contract interacts with three categories of external smart contracts: the underlying USDC Token contract (Soroban SEP-41 standard), the Blend Lending Pool contract, and DEX AMM Pool contracts.

### Summary Table of Cross-Contract Calls

| Invocation | Target Contract | Entrypoints | Expected Success Path | Revert Behavior | Partial-Fill Behavior | Vault Accounting Reaction & Test Mapping |
|------------|-----------------|-------------|-----------------------|-----------------|-----------------------|-------------------------------------------|
| `token_client.transfer` | USDC Token | `deposit`, `batch_deposit`, `withdraw`, `withdraw_all` | Tokens transferred between user and vault contract address; emits `DepositEvent` / `WithdrawEvent`. | Reverts on-chain (insufficient balance/allowance or frozen account). | Binary (all-or-nothing); no partial transfers in SEP-41. | Storage state updates execute **before** `transfer` (CEI pattern). Transaction revert rolls back storage state atomically. Tested in [`test_reentrancy_defense.rs`](neurowealth-vault/contracts/vault/src/tests/test_reentrancy_defense.rs) & [`test_stale_state_audit.rs`](neurowealth-vault/contracts/vault/src/tests/test_stale_state_audit.rs). |
| `token_client.balance` | USDC Token | `withdraw`, `withdraw_all`, `rebalance`, `update_total_assets`, `get_protocol_balance` | Returns `i128` token balance held at vault contract address. | Reverts only if contract WASM traps or token address invalid. | N/A (read-only query). | Balance queries act as upper-bound solvency checks. Direct token transfers to vault do not alter share exchange rates (storage-based accounting). |
| `BlendPoolClient::submit_with_allowance` | Blend Pool | `supply_to_blend` (called during `rebalance`, `harvest`, `emergency_harvest`) | Approves allowance and supplies USDC to Blend pool; returns amount supplied. | Reverts if pool paused, supply cap reached, or invalid configuration. | Accepts up to max supply limit if configured; returns actual `supplied` amount. | Updates `CurrentProtocol` to `symbol_short!("blend")`. Revert rolls back transaction atomically without changing protocol assignment. Tested in `test_blend_integration.rs`. |
| `BlendPoolClient::withdraw` / `withdraw_amount_from_protocol` | Blend Pool | `withdraw_from_blend` (called during `withdraw`, `withdraw_all`, `rebalance`, `harvest`) | Redeems USDC liquidity from Blend pool back to vault address. | Reverts if pool contract traps or is uninitialized. | If pool utilization is high, returns available liquidity (`withdrawn < requested`). | Reconciliation logic caps withdrawal to available USDC. User receives available funds and retains remaining shares (`convert_to_shares_internal_ceil_with_totals`). Tested in `test_partial_withdrawal` & [`test_strategy_switch_low_liquidity.rs`](neurowealth-vault/contracts/vault/src/tests/test_strategy_switch_low_liquidity.rs). |
| `BlendPoolClient::get_balance` | Blend Pool | `get_protocol_balance`, `update_total_assets` | Returns active deployed balance in Blend pool for vault address. | Reverts if pool call traps. | N/A (read-only query). | Solvency check in `update_total_assets`. Reported loss capped at `max_decrease_bps` (default 10%). Tested in [`test_asset_decrease.rs`](neurowealth-vault/contracts/vault/src/tests/test_asset_decrease.rs) & [`test_update_total_assets_blend.rs`](neurowealth-vault/contracts/vault/src/tests/test_update_total_assets_blend.rs). |
| `DexPoolClient::add_liquidity` | DEX Pool | `supply_to_dex` (called during `rebalance`, `harvest`, `emergency_harvest`) | Approves allowance, adds USDC liquidity to DEX pool, receives LP position tokens. | Reverts if slippage exceeded or pool paused. | Returns actual LP tokens minted based on pool balance ratio. | Updates `CurrentProtocol` to `symbol_short!("dex")`. If liquidity addition fails, strategy-switch fallback resets `CurrentProtocol` to `symbol_short!("none")` (idle) to protect funds. Tested in [`test_strategy_switch_low_liquidity.rs`](neurowealth-vault/contracts/vault/src/tests/test_strategy_switch_low_liquidity.rs). |
| `DexPoolClient::remove_liquidity` | DEX Pool | `withdraw_from_dex` (called during `withdraw`, `withdraw_all`, `rebalance`, `harvest`) | Redeems DEX LP position and returns underlying USDC to vault. | Reverts if pool traps or DEX contract panics. | Returns available underlying tokens based on current pool liquidity. | `withdraw` reconciles against returned USDC and burns proportional shares. Tested in [`test_update_total_assets_dex.rs`](neurowealth-vault/contracts/vault/src/tests/test_update_total_assets_dex.rs). |
| `DexPoolClient::get_balance` | DEX Pool | `get_protocol_balance`, `update_total_assets` | Returns current total valuation of vault LP tokens in DEX pool. | Reverts if pool call traps. | N/A (read-only query). | Used for solvency verification during asset updates. Guarded by decrease caps. |

### Failure-Mode Analysis & Revert Path Mapping

#### 1. Token Transfer Failure Path (`token_client.transfer`)
- **Failure Trigger**: User account has insufficient USDC balance, insufficient token allowance, or account is subject to Stellar clawback/freeze flags.
- **Handling**: The token contract call panics/reverts. Soroban automatically rolls back the entire atomic transaction frame.
- **Verification**: Covered by `test_deposit.rs`, `test_withdraw.rs`, and defense-in-depth reentrancy test [`test_reentrancy_defense.rs`](neurowealth-vault/contracts/vault/src/tests/test_reentrancy_defense.rs).

#### 2. Liquidity Crunch / Partial Fill (`withdraw_amount_from_protocol`)
- **Failure Trigger**: External lending pool (Blend) or DEX pool has high utilization or constrained liquidity when a user requests a withdrawal exceeding idle vault USDC.
- **Handling**: `withdraw_amount_from_protocol` redeems all available protocol liquidity (`available_usdc`). If `available_usdc < entitled_amount`, the vault processes a partial withdrawal: returning `available_usdc` and burning only `shares_to_burn = convert_to_shares_internal_ceil_with_totals(available_usdc, total_shares, total_assets)`. The user retains their remaining un-redeemed shares.
- **Verification**: Fully covered in `test_partial_withdrawal` and [`test_strategy_switch_low_liquidity.rs`](neurowealth-vault/contracts/vault/src/tests/test_strategy_switch_low_liquidity.rs).

#### 3. Low-Liquidity Strategy Switch Failure (`rebalance`)
- **Failure Trigger**: When `rebalance()` attempts to switch strategies (e.g. from idle to DEX pool) and the target DEX pool lacks sufficient liquidity for the swap.
- **Handling**: `rebalance()` catches low-liquidity failures and defaults `CurrentProtocol` back to `symbol_short!("none")` (idle USDC), ensuring vault funds remain safe and un-locked.
- **Verification**: Covered by [`test_strategy_switch_low_liquidity.rs`](neurowealth-vault/contracts/vault/src/tests/test_strategy_switch_low_liquidity.rs).

#### 4. Malicious Loss Reporting (`update_total_assets`)
- **Failure Trigger**: Compromised or malfunctioning AI Agent reports an artificially inflated asset balance or an un-authorized loss.
- **Handling**:
  - *Inflation*: Blocked by solvency verification (`total_available >= new_total`) where `total_available` is the sum of idle USDC balance and verified protocol balances.

---

## Storage Updates for New Features (#635, #636, #637)

### New Instance Storage Keys

| Key | Type | Description |
|-----|------|-------------|
| `MigrationTarget` | Address | Target vault address for user migration (#637) |
| `MigrationPaused` | bool | Independent pause state for migration operations (#637) |

### New Persistent Storage Keys

| Key | Type | Description |
|-----|------|-------------|
| `LockedShares(Address)` | i128 | User's locked shares for boosted APY (#636) |
| `LockExpiry(Address)` | u32 | Ledger when user's locked shares can be unlocked (#636) |

### Updated Access Patterns

| Key | Category | Writers | Readers | TTL |
|-----|----------|---------|---------|-----|
| `MigrationTarget` | Instance | Owner (set_migration_target) | Everyone | None |
| `MigrationPaused` | Instance | Owner (set_migration_paused) | Everyone | None |
| `LockedShares(user)` | Persistent | User (lock_shares, unlock_shares) | User, get_locked_shares | Automatic on write |
| `LockExpiry(user)` | Persistent | User (lock_shares) | User, unlock_shares, get_locked_shares | Automatic on write |

### Storage Key Updates

**New Instance Storage Keys (lines 39-40):**
```markdown
| `MigrationTarget` | Address | Target vault address for user migration (#637) |
| `MigrationPaused` | bool | Independent pause state for migration operations (#637) |
```

**New Persistent Storage Keys (lines 50-51):**
```markdown
| `LockedShares(Address)` | i128 | User's locked shares for boosted APY (#636) |
| `LockExpiry(Address)` | u32 | Ledger when user's locked shares can be unlocked (#636) |
```

---

## New Features (Issues #635, #636, #637)

### Emergency Withdrawal (#635)

**Purpose**: Allows users to withdraw funds even when the vault is paused, providing a safety mechanism during extended pauses or governance disputes.

**Key Features**:
- Works when vault is paused (unlike regular withdrawals)
- Requires user authentication (only their own funds)
- Deducts from idle balance first, then from protocol if needed
- Emits `EmergencyWithdrawalEvent` for audit trail
- Follows same rounding rules as regular withdrawals

**Storage**: No new storage keys (uses existing pause state)

**Events**: `EmergencyWithdrawalEvent` (topic `"em_wd"`)

**Security Considerations**:
- Only available when vault is paused
- Users can only withdraw their own funds
- Does not affect rebalance or admin operations
- Maintains same rounding and accounting rules as regular withdrawals

### Share Locking for Boosted APY (#636)

**Purpose**: Allows users to voluntarily lock shares for configurable periods in exchange for boosted APY, similar to ve-tokenomics patterns.

**Key Features**:
- Three lock duration tiers: 30 days (1.1x), 90 days (1.25x), 180 days (1.5x)
- Locked shares cannot be withdrawn until lock period expires
- Withdraw functions respect lock state (only unlocked shares can be withdrawn)
- Boost multiplier affects share price calculation
- Users can unlock shares after expiry

**Storage**:
- `LockedShares(Address)`: Number of shares locked by user
- `LockExpiry(Address)`: Ledger when locked shares can be unlocked

**Events**:
- `SharesLockedEvent` (topic `"lock"`)
- `SharesUnlockedEvent` (topic `"unlock"`)

**Security Considerations**:
- Lock enforced at contract level, not just UI
- Withdraw functions check lock state before processing
- Early withdrawal attempts fail with proper error codes
- Lock expiry checked at ledger level (not time-based)

### Vault Migration (#637)

**Purpose**: Enables trustless user migration from old vault to new vault during contract upgrades, preserving share value through exchange rate conversion.

**Key Features**:
- Owner sets migration target address
- Users can migrate shares independently
- Exchange rate preserved through conversion calculation
- Migration can be paused independently of main vault pause
- Comprehensive event logging for audit trails

**Storage**:
- `MigrationTarget`: Address of new vault contract
- `MigrationPaused`: Independent pause state for migration

**Events**:
- `SharesMigratedEvent` (topic `"migrate"`)
- `MigrationTargetUpdatedEvent` (topic `"mig_tgt"`)
- `MigrationPausedEvent` (topic `"mig_pse"`)

**Security Considerations**:
- Migration target must be owner-set (prevents malicious contracts)
- Migration can be paused independently for safety
- Exchange rate calculated at migration time to preserve value
- User authentication required for migration
- Full event logging enables audit trails

**Integration with Traditional Upgrades**:
- Can complement storage migrations or replace them
- Users maintain control over their funds during upgrades
- Provides flexibility for different upgrade scenarios
- Old vault remains operational as fallback
  - *Loss*: Decreases require owner co-signatures (`require_is_owner`) and are hard-capped at `max_decrease_bps` (minimum cap floor 100 bps / 1%, default 10%).
- **Verification**: Covered by [`test_asset_decrease.rs`](neurowealth-vault/contracts/vault/src/tests/test_asset_decrease.rs) and [`test_update_total_assets_blend.rs`](neurowealth-vault/contracts/vault/src/tests/test_update_total_assets_blend.rs).

