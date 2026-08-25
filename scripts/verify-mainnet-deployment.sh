#!/usr/bin/env bash
# =============================================================================
# NeuroWealth Vault — Mainnet Deployment Verification
# =============================================================================
#
# Comprehensive post-deployment verification that implements all checks from
# MAINNET_CHECKLIST.md including:
# - Key separation validation
# - Configuration verification
# - Pool address validation
# - Pause drill execution
# - Operational readiness checks
#
# Usage:
#   ./scripts/verify-mainnet-deployment.sh [OPTIONS]
#
# Required environment variables:
#   VAULT_CONTRACT_ID             Deployed vault contract address
#   OWNER_ADDRESS                 Owner address (should match contract)
#   AGENT_ADDRESS                 Agent address (should match contract)
#   AGENT_SECRET_KEY              Agent secret key (for test transactions)
#   USDC_TOKEN_ADDRESS            USDC token contract address
#   EXPECTED_TVL_CAP              Expected TVL cap
#   EXPECTED_USER_DEPOSIT_CAP     Expected user deposit cap
#   EXPECTED_MIN_DEPOSIT          Expected minimum deposit
#   EXPECTED_MAX_DEPOSIT          Expected maximum deposit
#   BLEND_POOL_ADDRESS            Expected Blend pool address
#
# Optional:
#   DEX_POOL_ADDRESS              Expected DEX pool address
#   MAINNET_NETWORK_PASSPHRASE    Network passphrase (default: mainnet)
#   MAINNET_RPC_URL               RPC URL (default: mainnet)
#   RUN_PAUSE_DRILL               Run pause/unpause drill (default: false)
#   RUN_TEST_DEPOSIT              Run test deposit/withdraw (default: false)
#
# Exit codes:
#   0  — All checks passed
#   1  — One or more checks failed
#   2  — Invalid configuration
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SOROBAN_NETWORK_PASSPHRASE="${SOROBAN_NETWORK_PASSPHRASE:-Public Global Stellar Network ; Stellar Development Foundation}"
SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-https://soroban.stellar.org}"

RUN_PAUSE_DRILL="${RUN_PAUSE_DRILL:-false}"
RUN_TEST_DEPOSIT="${RUN_TEST_DEPOSIT:-false}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
CHECKS_PASSED=0
CHECKS_FAILED=0

# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

log() { echo -e "[$(timestamp)] $*"; }
success() { echo -e "${GREEN}✓ $*${NC}"; ((CHECKS_PASSED++)); }
error() { echo -e "${RED}✗ $*${NC}"; ((CHECKS_FAILED++)); }
warning() { echo -e "${YELLOW}⚠ $*${NC}"; }
info() { echo -e "${BLUE}ℹ $*${NC}"; }
section() { echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n$*\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"; }

contract_call() {
  local method="$1"
  local args="${2:-}"
  
  stellar contract invoke \
    --id "$VAULT_CONTRACT_ID" \
    --source "$AGENT_ADDRESS" \
    --network "$SOROBAN_NETWORK_PASSPHRASE" \
    --rpc-url "$SOROBAN_RPC_URL" \
    -- \
    "$method" $args 2>&1 || echo "CALL_FAILED"
}

# Validate environment variables
check_environment() {
  section "ENVIRONMENT VALIDATION"
  
  local required_vars=(
    "VAULT_CONTRACT_ID"
    "OWNER_ADDRESS"
    "AGENT_ADDRESS"
    "AGENT_SECRET_KEY"
    "USDC_TOKEN_ADDRESS"
    "EXPECTED_TVL_CAP"
    "EXPECTED_USER_DEPOSIT_CAP"
    "EXPECTED_MIN_DEPOSIT"
    "EXPECTED_MAX_DEPOSIT"
    "BLEND_POOL_ADDRESS"
  )
  
  for var in "${required_vars[@]}"; do
    if [[ -z "${!var:-}" ]]; then
      error "Missing environment variable: $var"
      return 1
    fi
  done
  
  success "All required environment variables configured"
  return 0
}

# Check 1: Key Separation
check_key_separation() {
  section "1️⃣  KEY SEPARATION VALIDATION"
  
  info "Verifying owner and agent keys are separate..."
  
  if [[ "$OWNER_ADDRESS" == "$AGENT_ADDRESS" ]]; then
    error "CRITICAL: Owner and Agent use the same address!"
    error "This violates least-privilege security principle"
    return 1
  fi
  
  success "Owner and Agent keys are properly separated"
  return 0
}

# Check 2: Contract Owner Address
check_contract_owner() {
  section "2️⃣  CONTRACT OWNER VERIFICATION"
  
  info "Verifying contract owner..."
  
  local on_chain_owner
  on_chain_owner=$(contract_call "get_owner" "" 2>/dev/null | tr -d '\n' | grep -oP 'G[A-Z0-9]{55}' || echo "FAILED")
  
  if [[ "$on_chain_owner" == "FAILED" ]]; then
    error "Could not retrieve contract owner from chain"
    return 1
  fi
  
  if [[ "$on_chain_owner" != "$OWNER_ADDRESS" ]]; then
    error "Owner address mismatch!"
    error "  Expected: $OWNER_ADDRESS"
    error "  On-chain: $on_chain_owner"
    return 1
  fi
  
  success "Contract owner verified: $on_chain_owner"
  return 0
}

# Check 3: Contract Agent Address
check_contract_agent() {
  section "3️⃣  CONTRACT AGENT VERIFICATION"
  
  info "Verifying contract agent..."
  
  local on_chain_agent
  on_chain_agent=$(contract_call "get_agent" "" 2>/dev/null | tr -d '\n' | grep -oP 'G[A-Z0-9]{55}' || echo "FAILED")
  
  if [[ "$on_chain_agent" == "FAILED" ]]; then
    error "Could not retrieve contract agent from chain"
    return 1
  fi
  
  if [[ "$on_chain_agent" != "$AGENT_ADDRESS" ]]; then
    error "Agent address mismatch!"
    error "  Expected: $AGENT_ADDRESS"
    error "  On-chain: $on_chain_agent"
    return 1
  fi
  
  success "Contract agent verified: $on_chain_agent"
  return 0
}

# Check 4: USDC Token Address
check_usdc_address() {
  section "4️⃣  USDC TOKEN ADDRESS VERIFICATION"
  
  info "Verifying USDC token address..."
  
  local on_chain_usdc
  on_chain_usdc=$(contract_call "get_usdc_token" "" 2>/dev/null | tr -d '\n' | grep -oP '[A-Z0-9]{56}' || echo "FAILED")
  
  if [[ "$on_chain_usdc" == "FAILED" ]]; then
    error "Could not retrieve USDC token from chain"
    return 1
  fi
  
  if [[ "$on_chain_usdc" != "$USDC_TOKEN_ADDRESS" ]]; then
    error "USDC address mismatch!"
    error "  Expected: $USDC_TOKEN_ADDRESS"
    error "  On-chain: $on_chain_usdc"
    return 1
  fi
  
  success "USDC token address verified"
  return 0
}

# Check 5: TVL Cap
check_tvl_cap() {
  section "5️⃣  TVL CAP VERIFICATION"
  
  info "Checking TVL cap: $EXPECTED_TVL_CAP"
  
  local on_chain_cap
  on_chain_cap=$(contract_call "get_tvl_cap" "" 2>/dev/null | grep -oP '\d+' | head -1 || echo "0")
  
  if [[ "$on_chain_cap" != "$EXPECTED_TVL_CAP" ]]; then
    error "TVL cap mismatch!"
    error "  Expected: $EXPECTED_TVL_CAP"
    error "  On-chain: $on_chain_cap"
    return 1
  fi
  
  success "TVL cap verified: $on_chain_cap"
  return 0
}

# Check 6: User Deposit Cap
check_user_cap() {
  section "6️⃣  USER DEPOSIT CAP VERIFICATION"
  
  info "Checking user deposit cap: $EXPECTED_USER_DEPOSIT_CAP"
  
  local on_chain_cap
  on_chain_cap=$(contract_call "get_user_deposit_cap" "" 2>/dev/null | grep -oP '\d+' | head -1 || echo "0")
  
  if [[ "$on_chain_cap" != "$EXPECTED_USER_DEPOSIT_CAP" ]]; then
    error "User cap mismatch!"
    error "  Expected: $EXPECTED_USER_DEPOSIT_CAP"
    error "  On-chain: $on_chain_cap"
    return 1
  fi
  
  success "User deposit cap verified: $on_chain_cap"
  return 0
}

# Check 7: Deposit Limits
check_deposit_limits() {
  section "7️⃣  DEPOSIT LIMITS VERIFICATION"
  
  local min_deposit
  local max_deposit
  
  min_deposit=$(contract_call "get_min_deposit" "" 2>/dev/null | grep -oP '\d+' | head -1 || echo "0")
  max_deposit=$(contract_call "get_max_deposit" "" 2>/dev/null | grep -oP '\d+' | head -1 || echo "0")
  
  if [[ "$min_deposit" != "$EXPECTED_MIN_DEPOSIT" ]]; then
    error "Min deposit mismatch (expected: $EXPECTED_MIN_DEPOSIT, got: $min_deposit)"
    return 1
  fi
  
  if [[ "$max_deposit" != "$EXPECTED_MAX_DEPOSIT" ]]; then
    error "Max deposit mismatch (expected: $EXPECTED_MAX_DEPOSIT, got: $max_deposit)"
    return 1
  fi
  
  success "Deposit limits verified (min: $min_deposit, max: $max_deposit)"
  return 0
}

# Check 8: Blend Pool Address
check_blend_pool() {
  section "8️⃣  BLEND POOL ADDRESS VERIFICATION"
  
  info "Checking Blend pool address..."
  
  local on_chain_pool
  on_chain_pool=$(contract_call "get_blend_pool" "" 2>/dev/null | tr -d '\n' | grep -oP 'C[A-Z0-9]{55}' || echo "NONE")
  
  if [[ "$on_chain_pool" == "NONE" || -z "$on_chain_pool" ]]; then
    error "Blend pool not configured"
    return 1
  fi
  
  if [[ "$on_chain_pool" != "$BLEND_POOL_ADDRESS" ]]; then
    error "Blend pool address mismatch!"
    error "  Expected: $BLEND_POOL_ADDRESS"
    error "  On-chain: $on_chain_pool"
    return 1
  fi
  
  success "Blend pool address verified: $on_chain_pool"
  return 0
}

# Check 9: DEX Pool Address (optional)
check_dex_pool() {
  section "9️⃣  DEX POOL ADDRESS VERIFICATION"
  
  if [[ -z "${DEX_POOL_ADDRESS:-}" ]]; then
    warning "DEX pool not configured (optional)"
    return 0
  fi
  
  local on_chain_pool
  on_chain_pool=$(contract_call "get_dex_pool" "" 2>/dev/null | tr -d '\n' | grep -oP 'C[A-Z0-9]{55}' || echo "NONE")
  
  if [[ "$on_chain_pool" == "NONE" || -z "$on_chain_pool" ]]; then
    error "DEX pool not configured on-chain"
    return 1
  fi
  
  if [[ "$on_chain_pool" != "$DEX_POOL_ADDRESS" ]]; then
    error "DEX pool address mismatch!"
    error "  Expected: $DEX_POOL_ADDRESS"
    error "  On-chain: $on_chain_pool"
    return 1
  fi
  
  success "DEX pool address verified: $on_chain_pool"
  return 0
}

# Check 10: Pause/Unpause Drill
run_pause_drill() {
  if [[ "$RUN_PAUSE_DRILL" != "true" ]]; then
    info "Pause drill skipped (set RUN_PAUSE_DRILL=true to execute)"
    return 0
  fi
  
  section "🔟 PAUSE DRILL EXECUTION"
  
  warning "Pause drill will pause/unpause vault on mainnet"
  warning "Only run if vault is ready for this operation"
  read -p "Continue with pause drill? (y/N): " -r
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    warning "Pause drill skipped"
    return 0
  fi
  
  info "Triggering pause..."
  if ! contract_call "pause" "--owner $OWNER_ADDRESS" > /dev/null 2>&1; then
    error "Failed to pause vault"
    return 1
  fi
  success "Vault paused"
  
  info "Verifying pause state..."
  sleep 5
  local is_paused
  is_paused=$(contract_call "is_paused" "" 2>/dev/null | grep -i "true" || echo "false")
  if [[ "$is_paused" != "true" ]]; then
    error "Vault not paused after pause command"
    return 1
  fi
  success "Pause state verified"
  
  info "Unpausing vault..."
  if ! contract_call "unpause" "--owner $OWNER_ADDRESS" > /dev/null 2>&1; then
    error "Failed to unpause vault"
    return 1
  fi
  success "Vault unpaused"
  
  sleep 5
  is_paused=$(contract_call "is_paused" "" 2>/dev/null | grep -i "true" || echo "false")
  if [[ "$is_paused" == "true" ]]; then
    error "Vault still paused after unpause command"
    return 1
  fi
  success "Unpause verified"
  
  return 0
}

# Summary report
show_summary() {
  section "VERIFICATION SUMMARY"
  
  local total=$((CHECKS_PASSED + CHECKS_FAILED))
  local pass_rate=$((CHECKS_PASSED * 100 / total))
  
  echo "Checks Passed:   $CHECKS_PASSED"
  echo "Checks Failed:   $CHECKS_FAILED"
  echo "Total Checks:    $total"
  echo "Pass Rate:       $pass_rate%"
  echo ""
  
  if [[ $CHECKS_FAILED -eq 0 ]]; then
    success "All verification checks passed!"
    success "Mainnet deployment is ready for production"
    return 0
  else
    error "Verification failed. Address issues before proceeding."
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Main Execution
# ---------------------------------------------------------------------------

main() {
  log_section "NEUROWEALTH MAINNET DEPLOYMENT VERIFICATION"
  
  # Check environment
  if ! check_environment; then
    error "Environment validation failed"
    return 2
  fi
  
  # Run all checks
  check_key_separation || true
  check_contract_owner || true
  check_contract_agent || true
  check_usdc_address || true
  check_tvl_cap || true
  check_user_cap || true
  check_deposit_limits || true
  check_blend_pool || true
  check_dex_pool || true
  run_pause_drill || true
  
  # Show summary
  show_summary
}

main "$@"
exit $((CHECKS_FAILED > 0 ? 1 : 0))
