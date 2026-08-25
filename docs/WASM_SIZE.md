# WASM Size Management

## CI Limit

The CI pipeline fails if the optimised contract WASM exceeds **1.5 MB** (configurable via `WASM_SIZE_LIMIT_BYTES` in `.github/workflows/ci.yml`).

Stellar's Soroban network enforces a `maxContractSizeBytes` network parameter that caps how large a contract WASM can be when uploaded via `stellar contract upload`. The CI gate sits well below that limit to catch unintentional bloat early and leave room for future feature additions.

## Trend Tracking

The CI workflow now records the latest optimised WASM size for merged commits in `.github/wasm-size-history.json` and uses that baseline when a PR runs. The PR check reports the size delta versus the base branch in the workflow summary so gradual growth is visible even when the binary stays under the hard limit.

## Why This Matters

| Issue | Consequence |
|-------|-------------|
| WASM > network `maxContractSizeBytes` | Deployment transaction rejected by the Soroban network |
| WASM > CI limit | PR blocked until size is reduced |
| Gradual growth | Limits room for future feature additions |

## How to Reduce WASM Size

1. **Audit new dependencies** — `cargo bloat --release --crates` shows which crates contribute most to binary size.
2. **Use `no-default-features`** — disable crate features you don't need.
3. **Prefer `soroban-sdk` primitives** — avoid pulling in heavy `std` types where a simpler alternative exists.
4. **Avoid `format!` / `String` in hot paths** — string formatting pulls in significant code.
5. **Run `wasm-opt` locally** to see the post-optimisation size before pushing:
   ```bash
   RUSTFLAGS="-C target-cpu=mvp" cargo build \
     --target wasm32-unknown-unknown --release
   wasm-opt --strip-target-features --mvp-features \
     target/wasm32-unknown-unknown/release/neurowealth_vault.wasm \
     -o /tmp/vault_opt.wasm
   wc -c /tmp/vault_opt.wasm
   ```

## Size Trend Log

Entries are added whenever a PR meaningfully changes the compiled contract size. Record the
optimised size (post `wasm-opt`) against the merge commit so the history is reproducible.

| Date | Commit | Description | Optimised size (bytes) | Delta |
|------|--------|-------------|------------------------|-------|
| 2026-07-29 | *(baseline — pre-harvest feature)* | Baseline before harvest() code path was added | 487,312 | — |
| 2026-07-29 | *(harvest PR)* | Added `harvest()`, `HarvestEvent`, `TOPIC_HARVEST`, cooldown reuse via `LastRebalanceLedger` | 492,048 | +4,736 |

> **How to update this table:** after merging a PR that affects contract size, run the `wasm-opt`
> command from [How to Reduce WASM Size](#how-to-reduce-wasm-size) and append a row with today's
> date, the merge commit short hash, a brief description, and the new optimised size.

---

## Adjusting the Limit

If a deliberate feature addition requires a larger binary, update `WASM_SIZE_LIMIT_BYTES` in `ci.yml` in the same PR and document the reason in the PR description.
