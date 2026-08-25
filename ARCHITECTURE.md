# Architecture Documentation 

This document describes the technical architecture of the NeuroWealth Vault contract, including storage layout, data structures, and integration patterns.

## Overview

The NeuroWealth Vault is a Soroban smart contract that implements a non-custodial yield vault on the Stellar blockchain. Users deposit USDC, and an AI agent automatically deploys those funds across various yield-generating protocols.

## Storage Layout

### Instance Storage

Instance storage is used for contract-wide configuration that is read frequently but changes infrequently.

| Key | Type | Description |
|-----|------|-------------|
| `Agent` | Address | Authorized AI agent that can call rebalance() |
| `UsdcToken` | Address | USDC token contract address |
| `TotalDeposits` | i128 | Total USDC principal deposited (excluding yield) |
| `TotalShares` | i128 | Total vault shares in circulation |
| `TotalAssets` | i128 | Total managed assets (principal + yield) |
| `CurrentProtocol`| Symbol | Active protocol symbol ("blend", "none") |
| `BlendPool` | Address | Blend pool contract address |
| `Paused` | bool | Emergency pause state |
| `Owner` | Address | Contract owner for administrative functions |
| `PendingOwner` | Address | Pending owner for two-step transfer |
| `TvLCap` | i128 | Maximum total value locked |
| `UserDepositCap` | i128 | Maximum deposit per user |
| `BlendApprovalTtl` | u32 | Ledger TTL used for Blend approvals |
| `MinDeposit` | i128 | Minimum per-transaction deposit |
| `MaxDeposit` | i128 | Maximum per-transaction deposit |
| `Version` | u32 | Contract version for upgrade tracking |

### Persistent Storage

Persistent storage is used for per-user data that requires efficient access.

| Key | Type | Description |
|-----|------|-------------|
| `Balance(Address)` | i128 | User's principal USDC deposit amount |
| `Shares(Address)` | i128 | User's share balance (proportional ownership) |
| `UserStrategy(Address)` | Symbol | Per-user strategy preference (storage-only, see below) |

> **`UserStrategy` is storage-only:** `set_user_strategy` / `get_user_strategy` store a
> per-user preference symbol, but `rebalance()` and `deposit()` never read
> `DataKey::UserStrategy` — the vault deploys funds pooled to a single `CurrentProtocol`
> regardless of any individual user's selection. The off-chain AI agent is expected to
> consume this preference when deciding yield allocation. A user's chosen strategy can
> therefore diverge from where their share of the pooled funds is actually deployed.

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
    BlendApprovalTtl,     // Blend approval lifetime
    MinDeposit,           // minimum transaction amount
    MaxDeposit,           // maximum transaction amount
    Version,              // contract version
    BlendPool,            // Blend pool contract address
    CurrentProtocol,      // symbol of active protocol
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

### Yield Accrual via update_total_assets

The AI agent calls `update_total_assets(new_total)` to report yield earned in external protocols (e.g. Blend). This increases `TotalAssets` without changing `TotalShares`, which raises the share price for all holders. The update is bounded: a single call cannot decrease `TotalAssets` below the current value, and cannot increase it beyond a configurable maximum basis-point delta, preventing the agent from inflating balances arbitrarily.

### Blend Deployment

When the agent calls `rebalance(protocol="blend", ...)` the vault:

1. Approves the Blend pool to pull vault USDC (short-lived TTL approval stored in `BlendApprovalTtl`).
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

### Blend Protocol Integration

```
Vault Contract → Blend Protocol Contract
                 ↑
                 ├── submit_with_allowance() - lend USDC for yield
                 ├── submit() - withdraw from lending
                 └── balance() - check yield earned
```

The vault integrates with the Blend protocol to generate yield on deposited USDC. The AI agent triggers rebalancing to move funds into or out of Blend.

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
2. Agent calls `rebalance(protocol, expected_apy)` on vault.
3. Vault verifies caller is agent and protocol is supported.
4. Vault executes on-chain movement (e.g., supply to or withdraw from Blend).
5. `RebalanceEvent` emitted.

## Upgrade Model

### Storage Preservation

When upgrading the contract, the following storage keys must be preserved:

- `Shares(Address)` and `Balance(Address)`
- `TotalDeposits`, `TotalShares`, `TotalAssets`
- `Agent`, `UsdcToken`, `Owner`, `Paused`
- `TvLCap`, `UserDepositCap`, `BlendApprovalTtl`, `MinDeposit`, `MaxDeposit`
- `BlendPool`, `CurrentProtocol`
- `Version` (incremented)

### Version History

| Version | Changes | Status |
|---------|---------|--------|
| 1 | Initial 1:1 balance accounting (no shares) | Historical — superseded |
| 2 | ERC-4626 share accounting, Blend integration, rounding rules | **Current** |
| 3 | (Planned) Multi-asset support and advanced rebalancing | Future |

## Error Handling

Errors are surfaced as typed `VaultError` contract errors rather than raw panic
strings. See [ERROR_STYLE_GUIDE.md](ERROR_STYLE_GUIDE.md) for the full code
table and wording conventions.

### Key error codes by function

| Function | VaultError variant (code) | Condition |
|----------|--------------------------|-----------|
| `initialize` | `AlreadyInitialized` (#4) | Called more than once |
| `deposit` | `Paused` (#35) | Vault is paused |
| `deposit` | `AmountMustBePositive` (#37) | amount ≤ 0 |
| `deposit` | `BelowMinimumDeposit` (#38) | amount < min_deposit |
| `deposit` | `ExceedsUserDepositCap` (#40) | user cumulative > cap |
| `deposit` | `ExceedsTvlCap` (#41) | total_assets + amount > tvl_cap |
| `withdraw` | `Paused` (#35) | Vault is paused |
| `withdraw` | `AmountMustBePositive` (#37) | amount ≤ 0 |
| `withdraw` | `InsufficientShares` (#8) | shares to burn > user shares |
| `rebalance` | `Paused` (#35) | Vault is paused |
| `unpause` | `NotPaused` (#21) | Called when not paused |

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
|---|---|---|
| `deposit` | < 5 000 000 | < 300 000 |
| `withdraw` (no Blend) | < 5 000 000 | < 300 000 |
| `withdraw` (Blend pull) | < 15 000 000 | < 600 000 |
| `rebalance → blend` | < 15 000 000 | < 600 000 |
| `rebalance → none` | < 15 000 000 | < 600 000 |

Cross-contract operations (Blend supply/withdraw) cost roughly 3× a simple
deposit because each `invoke_contract` carries its own CPU and memory overhead.

## Idle vs Deployed Asset Tracking (Issue #321)

The vault distinguishes between two components of its total managed value:

| Component | Getter | Description |
|---|---|---|
| **Idle** | `get_idle_balance()` | USDC held directly in the vault contract, not yet deployed to any protocol. |
| **Deployed** | `get_deployed_assets()` | USDC currently supplied to an external yield protocol (e.g., Blend, DEX). |

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
|---|---|---|---|
| `TotalDeposits` | `deposit`, `withdraw` | No | Principal bookkeeping, reporting only |
| `TotalAssets` | `deposit`, `withdraw`, `update_total_assets` | Yes | Share pricing, TVL cap guard, all economic math |

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

## Upgrade Safety (Issue #189)

`upgrade()` is gated by `require_not_paused()`.  During an incident the operator
pauses the vault to freeze user operations; the upgrade guard ensures that a
compromised or mistaken WASM upgrade cannot be pushed while the vault is in a
degraded state.  To upgrade: unpause → upgrade → re-pause if needed.
4. Minimize state changes in single transaction
