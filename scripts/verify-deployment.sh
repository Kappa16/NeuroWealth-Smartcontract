#!/usr/bin/env bash
# =============================================================================
# NeuroWealth Vault — Post-Deploy Verification (Mainnet Preflight Checks)
# =============================================================================
#
# Reads an env file (default: scripts/devnet-contracts.env) and verifies
# vault configuration via read-only contract invocations. Can also be driven
# entirely by shell environment variables for mainnet use (no env file needed).
#
# Usage:
#   ./scripts/verify-deployment.sh [--help] [ENV_FILE]
#
# Arguments:
#   ENV_FILE   Path to contract env file (default: scripts/devnet-contracts.env)
#              Omit or set to "" to rely on shell env vars only.
#
# Required environment variables:
#   VAULT_CONTRACT_ID     — deployed vault contract address
#   OWNER_ADDRESS         — expected owner address
#   AGENT_ADDRESS         — expected agent address
#   AGENT_SECRET_KEY      — secret key used as --source-account for simulations
#   USDC_TOKEN_ADDRESS    — expected USDC token address
#
# Network selection (choose one):
#   NETWORK               — named Stellar network ("mainnet", "testnet", etc.)
#                           If set, SOROBAN_RPC_URL and SOROBAN_NETWORK_PASSPHRASE
#                           are not required.
#   SOROBAN_NETWORK_PASSPHRASE + SOROBAN_RPC_URL
#                         — used for custom/standalone networks when NETWORK is unset.
#
# Cap verification (all four required for mainnet preflight):
#   EXPECTED_TVL_CAP          — expected on-chain TVL cap (6-decimal integer)
#   EXPECTED_USER_DEPOSIT_CAP — expected per-user cap
#   EXPECTED_MIN_DEPOSIT      — expected minimum deposit
#   EXPECTED_MAX_DEPOSIT      — expected maximum deposit
#
# Optional protocol pool checks:
#   BLEND_POOL_ADDRESS    — if set, verifies get_blend_pool() matches this value
#   DEX_POOL_ADDRESS      — if set, verifies get_dex_pool() matches this value
#
# Exit codes:
#   0  — All checks passed
#   1  — One or more checks failed
#   2  — Invalid usage or missing configuration
#
# Examples:
#   # Devnet (env file):
#   ./scripts/deploy-devnet.sh
#   ./scripts/verify-deployment.sh
#
#   # Testnet / Mainnet (env vars only):
#   VAULT_CONTRACT_ID=C... NETWORK=mainnet \
#     OWNER_ADDRESS=G... AGENT_ADDRESS=G... AGENT_SECRET_KEY=S... \
#     USDC_TOKEN_ADDRESS=G... \
#     EXPECTED_TVL_CAP=100000000000 EXPECTED_USER_DEPOSIT_CAP=5000000000 \
#     EXPECTED_MIN_DEPOSIT=1000000 EXPECTED_MAX_DEPOSIT=5000000000 \
#     BLEND_POOL_ADDRESS=C... \
#     ./scripts/verify-deployment.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ENV_FILE="$SCRIPT_DIR/devnet-contracts.env"

ENV_FILE="${1:-$DEFAULT_ENV_FILE}"
FAILURES=0
CHECKS_RUN=0
CHECKS_PASSED=0

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log()  { echo "[$(timestamp)] $*"; }

show_help() {
  cat << EOF
NeuroWealth Vault — Post-Deploy Verification (Mainnet Preflight Checks)

USAGE:
    $0 [--help] [ENV_FILE]

ARGUMENTS:
    ENV_FILE    Contract env file (default: $DEFAULT_ENV_FILE)
                Omit to drive entirely from shell environment variables.

REQUIRED ENV VARS:
    VAULT_CONTRACT_ID, OWNER_ADDRESS, AGENT_ADDRESS,
    AGENT_SECRET_KEY, USDC_TOKEN_ADDRESS

NETWORK (choose one):
    NETWORK                            named network (mainnet / testnet)
    SOROBAN_NETWORK_PASSPHRASE +       custom / standalone network
    SOROBAN_RPC_URL

CAP VERIFICATION:
    EXPECTED_TVL_CAP, EXPECTED_USER_DEPOSIT_CAP,
    EXPECTED_MIN_DEPOSIT, EXPECTED_MAX_DEPOSIT

OPTIONAL:
    BLEND_POOL_ADDRESS    verify get_blend_pool() matches this address

EXIT CODES:
    0  all checks passed
    1  one or more checks failed
    2  invalid usage or missing configuration
EOF
}

fail() {
  log "FAIL: $*"
  FAILURES=$((FAILURES + 1))
  CHECKS_RUN=$((CHECKS_RUN + 1))
}

pass() {
  log "PASS: $*"
  CHECKS_PASSED=$((CHECKS_PASSED + 1))
  CHECKS_RUN=$((CHECKS_RUN + 1))
}

info() {
  log "INFO: $*"
}

normalize_address() {
  local raw="$1"
  raw="${raw//\"/}"
  raw="${raw//$'\n'/}"
  raw="${raw//[[:space:]]/}"
  echo "$raw"
}

normalize_int() {
  local raw="$1"
  raw="${raw//\"/}"
  raw="${raw//$'\n'/}"
  raw="${raw//[[:space:]]/}"
  echo "$raw"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  show_help
  exit 0
fi

# ---------------------------------------------------------------------------
# Load env file (optional when VAULT_CONTRACT_ID is already exported)
# ---------------------------------------------------------------------------

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
elif [[ -z "${VAULT_CONTRACT_ID:-}" ]]; then
  log "ERROR: env file not found: $ENV_FILE"
  log "Either run ./scripts/deploy-devnet.sh first, pass a valid ENV_FILE path,"
  log "or export VAULT_CONTRACT_ID and related variables directly."
  exit 2
fi

# ---------------------------------------------------------------------------
# Validate required variables
# ---------------------------------------------------------------------------

REQUIRED_VARS=(VAULT_CONTRACT_ID OWNER_ADDRESS AGENT_ADDRESS AGENT_SECRET_KEY USDC_TOKEN_ADDRESS)

if [[ -z "${NETWORK:-}" ]]; then
  REQUIRED_VARS+=(SOROBAN_RPC_URL SOROBAN_NETWORK_PASSPHRASE)
fi

for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    log "ERROR: missing required variable: $var"
    exit 2
  fi
done

if ! command -v stellar &> /dev/null; then
  log "ERROR: stellar CLI not found"
  exit 2
fi

# ---------------------------------------------------------------------------
# Build network args
# ---------------------------------------------------------------------------

if [[ -n "${NETWORK:-}" ]]; then
  STELLAR_NETWORK_ARGS=(--network "$NETWORK")
  DISPLAY_NETWORK="$NETWORK"
else
  STELLAR_NETWORK_ARGS=(--network "$SOROBAN_NETWORK_PASSPHRASE" --rpc-url "$SOROBAN_RPC_URL")
  DISPLAY_NETWORK="$SOROBAN_NETWORK_PASSPHRASE"
fi

# ---------------------------------------------------------------------------
# invoke_view: read-only contract invocation
# ---------------------------------------------------------------------------

invoke_view() {
  local description="$1"
  shift
  log "  invoke: $description"
  local output
  if ! output=$(stellar contract invoke \
    --id "$VAULT_CONTRACT_ID" \
    --source-account "$AGENT_SECRET_KEY" \
    "${STELLAR_NETWORK_ARGS[@]}" \
    --send=no \
    -- "$@" 2>&1); then
    log "  error output: $output"
    return 1
  fi
  echo "$output"
}

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

log "======================================================================"
log "NeuroWealth Vault — Mainnet Preflight Verification"
log "  Vault   : $VAULT_CONTRACT_ID"
log "  Network : $DISPLAY_NETWORK"
log "  Owner   : $OWNER_ADDRESS"
log "  Agent   : $AGENT_ADDRESS"
log "  Token   : $USDC_TOKEN_ADDRESS"
log "======================================================================"

# ---------------------------------------------------------------------------
# 1. Agent address
# ---------------------------------------------------------------------------

AGENT_OUTPUT=$(invoke_view "get_agent" get_agent) || {
  fail "get_agent invocation failed (vault may not be initialized)"
  AGENT_OUTPUT=""
}

ON_CHAIN_AGENT=""
if [[ -n "$AGENT_OUTPUT" ]]; then
  ON_CHAIN_AGENT=$(normalize_address "$AGENT_OUTPUT")
  EXPECTED_AGENT=$(normalize_address "$AGENT_ADDRESS")
  if [[ "$ON_CHAIN_AGENT" == "$EXPECTED_AGENT" ]]; then
    pass "get_agent matches AGENT_ADDRESS"
  else
    fail "get_agent mismatch: on-chain=$ON_CHAIN_AGENT expected=$EXPECTED_AGENT"
  fi
fi

# ---------------------------------------------------------------------------
# 2. Owner address
# ---------------------------------------------------------------------------

OWNER_OUTPUT=$(invoke_view "get_owner" get_owner) || {
  fail "get_owner invocation failed"
  OWNER_OUTPUT=""
}

ON_CHAIN_OWNER=""
if [[ -n "$OWNER_OUTPUT" ]]; then
  ON_CHAIN_OWNER=$(normalize_address "$OWNER_OUTPUT")
  EXPECTED_OWNER=$(normalize_address "$OWNER_ADDRESS")
  if [[ "$ON_CHAIN_OWNER" == "$EXPECTED_OWNER" ]]; then
    pass "get_owner matches OWNER_ADDRESS"
  else
    fail "get_owner mismatch: on-chain=$ON_CHAIN_OWNER expected=$EXPECTED_OWNER"
  fi
fi

# ---------------------------------------------------------------------------
# 3. Owner != Agent (key separation — security invariant)
# ---------------------------------------------------------------------------

if [[ -n "$ON_CHAIN_OWNER" && -n "$ON_CHAIN_AGENT" ]]; then
  if [[ "$ON_CHAIN_OWNER" == "$ON_CHAIN_AGENT" ]]; then
    fail "CRITICAL: owner == agent — key separation violated (on-chain owner=$ON_CHAIN_OWNER)"
  else
    pass "owner != agent (key separation confirmed)"
  fi
else
  info "owner/agent separation check skipped (one or both invocations failed above)"
fi

# ---------------------------------------------------------------------------
# 4. USDC token
# ---------------------------------------------------------------------------

TOKEN_OUTPUT=$(invoke_view "get_usdc_token" get_usdc_token) || {
  fail "get_usdc_token invocation failed"
  TOKEN_OUTPUT=""
}

if [[ -n "$TOKEN_OUTPUT" ]]; then
  ON_CHAIN_TOKEN=$(normalize_address "$TOKEN_OUTPUT")
  EXPECTED_TOKEN=$(normalize_address "$USDC_TOKEN_ADDRESS")
  if [[ "$ON_CHAIN_TOKEN" == "$EXPECTED_TOKEN" ]]; then
    pass "get_usdc_token matches USDC_TOKEN_ADDRESS"
  else
    fail "get_usdc_token mismatch: on-chain=$ON_CHAIN_TOKEN expected=$EXPECTED_TOKEN"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Pause state
# ---------------------------------------------------------------------------

PAUSED_OUTPUT=$(invoke_view "is_paused" is_paused) || {
  fail "is_paused invocation failed"
  PAUSED_OUTPUT=""
}

if [[ -n "$PAUSED_OUTPUT" ]]; then
  PAUSED_NORM=$(echo "$PAUSED_OUTPUT" | tr -d '[:space:]"')
  if [[ "$PAUSED_NORM" == "false" || "$PAUSED_NORM" == "False" ]]; then
    pass "is_paused is false (vault operational)"
  else
    fail "is_paused expected false, got: $PAUSED_OUTPUT"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Version (initialized sanity check)
# ---------------------------------------------------------------------------

VERSION_OUTPUT=$(invoke_view "get_version" get_version) || {
  fail "get_version invocation failed"
  VERSION_OUTPUT=""
}

if [[ -n "$VERSION_OUTPUT" ]]; then
  VERSION_NORM=$(echo "$VERSION_OUTPUT" | tr -d '[:space:]"')
  if [[ "$VERSION_NORM" =~ ^[1-9][0-9]*$ ]]; then
    pass "get_version returned $VERSION_NORM (initialized)"
  else
    fail "get_version unexpected value: $VERSION_OUTPUT"
  fi
fi

# ---------------------------------------------------------------------------
# 7. Administrative caps & deposit limits
# ---------------------------------------------------------------------------

check_cap() {
  local getter="$1"
  local expected_var="$2"
  local label="$3"

  if [[ -z "${!expected_var:-}" ]]; then
    fail "$expected_var not set — cap verification required for mainnet preflight"
    return
  fi

  local output
  output=$(invoke_view "$getter" "$getter") || {
    fail "$getter invocation failed"
    return
  }

  local actual expected
  actual=$(normalize_int "$output")
  expected=$(normalize_int "${!expected_var}")

  if [[ "$actual" == "$expected" ]]; then
    pass "$label: $actual (matches $expected_var)"
  else
    fail "$label mismatch: on-chain=$actual expected=$expected"
  fi
}

check_cap "get_tvl_cap"          "EXPECTED_TVL_CAP"          "TVL cap"
check_cap "get_user_deposit_cap" "EXPECTED_USER_DEPOSIT_CAP" "user deposit cap"
check_cap "get_min_deposit"      "EXPECTED_MIN_DEPOSIT"      "min deposit"
check_cap "get_max_deposit"      "EXPECTED_MAX_DEPOSIT"      "max deposit"

# ---------------------------------------------------------------------------
# 8. Additional getter coverage
# ---------------------------------------------------------------------------

USER_STRATEGY_OUTPUT=$(invoke_view "get_user_strategy" get_user_strategy "$OWNER_ADDRESS") || {
  fail "get_user_strategy invocation failed"
  USER_STRATEGY_OUTPUT=""
}

if [[ -n "$USER_STRATEGY_OUTPUT" ]]; then
  USER_STRATEGY_NORM=$(normalize_address "$USER_STRATEGY_OUTPUT")
  if [[ "$USER_STRATEGY_NORM" == "balanced" ]]; then
    pass "get_user_strategy defaults to balanced"
  else
    fail "get_user_strategy unexpected value: $USER_STRATEGY_OUTPUT"
  fi
fi

IDLE_OUTPUT=$(invoke_view "get_idle_balance" get_idle_balance) || {
  fail "get_idle_balance invocation failed"
  IDLE_OUTPUT=""
}
if [[ -n "$IDLE_OUTPUT" ]]; then
  pass "get_idle_balance returned $IDLE_OUTPUT"
fi

DEPLOYED_OUTPUT=$(invoke_view "get_deployed_assets" get_deployed_assets) || {
  fail "get_deployed_assets invocation failed"
  DEPLOYED_OUTPUT=""
}
if [[ -n "$DEPLOYED_OUTPUT" ]]; then
  pass "get_deployed_assets returned $DEPLOYED_OUTPUT"
fi

BREAKDOWN_OUTPUT=$(invoke_view "get_asset_breakdown" get_asset_breakdown) || {
  fail "get_asset_breakdown invocation failed"
  BREAKDOWN_OUTPUT=""
}
if [[ -n "$BREAKDOWN_OUTPUT" ]]; then
  pass "get_asset_breakdown returned $BREAKDOWN_OUTPUT"
fi

REBALANCE_COOLDOWN_OUTPUT=$(invoke_view "get_rebalance_cooldown" get_rebalance_cooldown) || {
  fail "get_rebalance_cooldown invocation failed"
  REBALANCE_COOLDOWN_OUTPUT=""
}
if [[ -n "$REBALANCE_COOLDOWN_OUTPUT" ]]; then
  pass "get_rebalance_cooldown returned $REBALANCE_COOLDOWN_OUTPUT"
fi

LAST_REBALANCE_LEDGER_OUTPUT=$(invoke_view "get_last_rebalance_ledger" get_last_rebalance_ledger) || {
  fail "get_last_rebalance_ledger invocation failed"
  LAST_REBALANCE_LEDGER_OUTPUT=""
}
if [[ -n "$LAST_REBALANCE_LEDGER_OUTPUT" ]]; then
  pass "get_last_rebalance_ledger returned $LAST_REBALANCE_LEDGER_OUTPUT"
fi

APPROVAL_TTL_OUTPUT=$(invoke_view "get_approval_ttl" get_approval_ttl) || {
  fail "get_approval_ttl invocation failed"
  APPROVAL_TTL_OUTPUT=""
}
if [[ -n "$APPROVAL_TTL_OUTPUT" ]]; then
  pass "get_approval_ttl returned $APPROVAL_TTL_OUTPUT"
fi

PENDING_AGENT_UPDATE_OUTPUT=$(invoke_view "get_pending_agent_update" get_pending_agent_update) || {
  fail "get_pending_agent_update invocation failed"
  PENDING_AGENT_UPDATE_OUTPUT=""
}
if [[ -n "$PENDING_AGENT_UPDATE_OUTPUT" ]]; then
  pass "get_pending_agent_update returned $PENDING_AGENT_UPDATE_OUTPUT"
fi

PENDING_UPGRADE_OUTPUT=$(invoke_view "get_pending_upgrade" get_pending_upgrade) || {
  fail "get_pending_upgrade invocation failed"
  PENDING_UPGRADE_OUTPUT=""
}
if [[ -n "$PENDING_UPGRADE_OUTPUT" ]]; then
  pass "get_pending_upgrade returned $PENDING_UPGRADE_OUTPUT"
fi

# ---------------------------------------------------------------------------
# 9. Blend pool address (optional — skip if BLEND_POOL_ADDRESS not set)
# ---------------------------------------------------------------------------

if [[ -z "${BLEND_POOL_ADDRESS:-}" ]]; then
  info "blend pool check skipped — BLEND_POOL_ADDRESS not set"
else
  BLEND_OUTPUT=$(invoke_view "get_blend_pool" get_blend_pool) || {
    fail "get_blend_pool invocation failed"
    BLEND_OUTPUT=""
  }

  if [[ -n "$BLEND_OUTPUT" ]]; then
    BLEND_NORM=$(normalize_address "$BLEND_OUTPUT")
    if [[ "$BLEND_NORM" == "null" || -z "$BLEND_NORM" ]]; then
      fail "get_blend_pool returned null — Blend pool not configured on-chain"
    else
      EXPECTED_BLEND=$(normalize_address "$BLEND_POOL_ADDRESS")
      if [[ "$BLEND_NORM" == "$EXPECTED_BLEND" ]]; then
        pass "get_blend_pool matches BLEND_POOL_ADDRESS"
      else
        fail "get_blend_pool mismatch: on-chain=$BLEND_NORM expected=$EXPECTED_BLEND"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 10. DEX pool address (optional — skip if DEX_POOL_ADDRESS not set)
# ---------------------------------------------------------------------------

if [[ -z "${DEX_POOL_ADDRESS:-}" ]]; then
  info "DEX pool check skipped — DEX_POOL_ADDRESS not set"
else
  DEX_OUTPUT=$(invoke_view "get_dex_pool" get_dex_pool) || {
    fail "get_dex_pool invocation failed"
    DEX_OUTPUT=""
  }

  if [[ -n "$DEX_OUTPUT" ]]; then
    DEX_NORM=$(normalize_address "$DEX_OUTPUT")
    if [[ "$DEX_NORM" == "null" || -z "$DEX_NORM" ]]; then
      fail "get_dex_pool returned null — DEX pool not configured on-chain"
    else
      EXPECTED_DEX=$(normalize_address "$DEX_POOL_ADDRESS")
      if [[ "$DEX_NORM" == "$EXPECTED_DEX" ]]; then
        pass "get_dex_pool matches DEX_POOL_ADDRESS"
      else
        fail "get_dex_pool mismatch: on-chain=$DEX_NORM expected=$EXPECTED_DEX"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Summary report
# ---------------------------------------------------------------------------

echo ""
echo "==================== VERIFICATION REPORT ===================="
echo "  VAULT_CONTRACT_ID : $VAULT_CONTRACT_ID"
echo "  NETWORK           : $DISPLAY_NETWORK"
echo "  Checks run        : $CHECKS_RUN"
echo "  Checks passed     : $CHECKS_PASSED"
echo "  Checks failed     : $FAILURES"
echo "============================================================="

if [[ "$FAILURES" -eq 0 ]]; then
  log "All deployment checks passed."
  exit 0
else
  log "$FAILURES check(s) failed."
  exit 1
fi
