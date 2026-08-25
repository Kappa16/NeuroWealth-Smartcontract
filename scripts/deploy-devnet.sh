#!/usr/bin/env bash
# =============================================================================
# NeuroWealth Vault — Devnet Deployment Script
# =============================================================================
#
# Deploys the vault contract and mock USDC token to Stellar devnet.
# This script outputs contract IDs and addresses for easy integration.
#
# Usage:
#   ./scripts/deploy-devnet.sh [--help] [--force]
#
# Options:
#   --help     Show this help message
#   --force    Redeploy even if contracts already exist
#
# Environment variables (see .env.devnet template):
#   SOROBAN_SECRET_KEY    Funded devnet secret key for deployment
#   SOROBAN_RPC_URL       RPC endpoint (default: devnet)
#   SOROBAN_NETWORK_PASSPHRASE  Network passphrase (default: devnet)
#
# Exit codes:
#   0  — Deployment successful
#   1  — Deployment failed
#   2  — Invalid arguments
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/neurowealth-vault/contracts"
WASM_PATH="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release/neurowealth_vault.wasm"
TOKEN_WASM_PATH="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release/test_token.wasm"

# Default network settings
SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-https://soroban-devnet.stellar.org}"
SOROBAN_NETWORK_PASSPHRASE="${SOROBAN_NETWORK_PASSPHRASE:-Standalone Network ; February 2023}"

# Output files
DEPLOYMENT_LOG="$SCRIPT_DIR/devnet-deployment.log"
CONTRACT_ADDRESSES="$SCRIPT_DIR/devnet-contracts.env"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

timestamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

log() { echo "[$(timestamp)] $*"; }

log_section() {
  echo ""
  echo "================================================================="
  echo "  $*"
  echo "================================================================="
  echo ""
}

show_help() {
  cat << EOF
NeuroWealth Vault Devnet Deployment Script

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --help      Show this help message
    --force     Redeploy even if contracts already exist

ENVIRONMENT VARIABLES:
    SOROBAN_SECRET_KEY           Your funded devnet secret key
    SOROBAN_RPC_URL              RPC endpoint (default: devnet)
    SOROBAN_NETWORK_PASSPHRASE   Network passphrase (default: devnet)

EXAMPLE:
    # Basic deployment
    $0
    
    # Force redeployment
    $0 --force

    # With custom environment
    SOROBAN_SECRET_KEY=your_secret_key $0

EOF
}

# Check if stellar CLI is installed and matches the pinned version
check_stellar_cli() {
  local pinned_version
  pinned_version=$(cat "$REPO_ROOT/.stellar-version" | tr -d '[:space:]')

  if ! command -v stellar &> /dev/null; then
    log "ERROR: stellar CLI not found. Please install version $pinned_version:"
    log "  cargo install --locked stellar-cli --version $pinned_version --features opt"
    exit 1
  fi

  local installed_version
  installed_version=$(stellar --version 2>/dev/null | awk '{print $2}')
  if [[ "$installed_version" != "$pinned_version" ]]; then
    log "WARNING: Stellar CLI version drift detected!"
    log "  Installed: $installed_version"
    log "  Pinned:    $pinned_version"
    log "Please install the pinned version to avoid build/deployment breakage."
  fi
}

# Check environment variables
check_env() {
  if [[ -z "${SOROBAN_SECRET_KEY:-}" ]]; then
    log "ERROR: SOROBAN_SECRET_KEY environment variable is required"
    log "Create a .env.devnet file with your secret key or export it:"
    log "  export SOROBAN_SECRET_KEY=your_secret_key"
    exit 1
  fi
}

# Check if contracts are built
check_contracts() {
  if [[ ! -f "$WASM_PATH" ]]; then
    log "ERROR: Vault contract not found at $WASM_PATH"
    log "Build the contract first:"
    log "  cd neurowealth-vault && cargo build --release --target wasm32-unknown-unknown"
    exit 1
  fi

  if [[ ! -f "$TOKEN_WASM_PATH" ]]; then
    log "ERROR: Token contract not found at $TOKEN_WASM_PATH"
    log "Build the token contract first:"
    log "  cd neurowealth-vault && cargo build --release --target wasm32-unknown-unknown"
    exit 1
  fi
}

# Deploy a contract and return its address
deploy_contract() {
  local wasm_path="$1"
  local contract_name="$2"
  
  log "Deploying $contract_name..."
  
  local contract_id
  if contract_id=$(stellar contract deploy \
    --wasm "$wasm_path" \
    --source "$SOROBAN_SECRET_KEY" \
    --network "$SOROBAN_NETWORK_PASSPHRASE" \
    --rpc-url "$SOROBAN_RPC_URL" 2>&1); then
    log "✓ $contract_name deployed successfully"
    echo "$contract_id"
  else
    log "✗ Failed to deploy $contract_name"
    log "Error: $contract_id"
    exit 1
  fi
}

# Initialize the vault contract
initialize_vault() {
  local vault_address="$1"
  local token_address="$2"
  local deployer_address="$3"
  
  log "Initializing vault contract..."
  
  if stellar contract invoke \
    --id "$vault_address" \
    --source "$SOROBAN_SECRET_KEY" \
    --network "$SOROBAN_NETWORK_PASSPHRASE" \
    --rpc-url "$SOROBAN_RPC_URL" \
    -- \
    initialize \
    --agent "$deployer_address" \
    --usdc_token "$token_address" 2>&1; then
    log "✓ Vault initialized successfully"
  else
    log "✗ Failed to initialize vault"
    exit 1
  fi
}

# Mint initial tokens to the deployer
mint_initial_tokens() {
  local token_address="$1"
  local deployer_address="$2"
  
  log "Minting initial USDC tokens..."
  
  if stellar contract invoke \
    --id "$token_address" \
    --source "$SOROBAN_SECRET_KEY" \
    --network "$SOROBAN_NETWORK_PASSPHRASE" \
    --rpc-url "$SOROBAN_RPC_URL" \
    -- \
    mint \
    --to "$deployer_address" \
    --amount 10000000000 2>&1; then
    log "✓ Initial tokens minted (10,000 USDC)"
  else
    log "✗ Failed to mint initial tokens"
    exit 1
  fi
}

# Save contract addresses to file
save_contract_addresses() {
  local vault_address="$1"
  local token_address="$2"
  local deployer_address="$3"
  
  cat > "$CONTRACT_ADDRESSES" << EOF
# NeuroWealth Vault Devnet Contract Addresses
# Generated on $(timestamp)

# Stellar Devnet Configuration
SOROBAN_RPC_URL="$SOROBAN_RPC_URL"
SOROBAN_NETWORK_PASSPHRASE="$SOROBAN_NETWORK_PASSPHRASE"

# Contract Addresses
VAULT_CONTRACT_ID="$vault_address"
USDC_TOKEN_ADDRESS="$token_address"
DEPLOYER_ADDRESS="$deployer_address"

# Owner (deployer is the initial owner after initialize)
OWNER_ADDRESS="$deployer_address"

# AI Agent (using deployer key for testing)
# Note: AGENT_SECRET_KEY is not saved here for security.
# Use your SOROBAN_SECRET_KEY environment variable for transactions.
AGENT_ADDRESS="$deployer_address"

# Example Usage
# To deposit: stellar contract invoke --id \$VAULT_CONTRACT_ID --source \$SOROBAN_SECRET_KEY --network \$SOROBAN_NETWORK_PASSPHRASE --rpc-url \$SOROBAN_RPC_URL -- deposit --user \$AGENT_ADDRESS --amount 10000000
# To check balance: stellar contract invoke --id \$VAULT_CONTRACT_ID --source \$SOROBAN_SECRET_KEY --network \$SOROBAN_NETWORK_PASSPHRASE --rpc-url \$SOROBAN_RPC_URL -- -- get_balance --user \$AGENT_ADDRESS
EOF

  log "Contract addresses saved to: $CONTRACT_ADDRESSES"
}

# Display deployment summary
show_summary() {
  local vault_address="$1"
  local token_address="$2"
  local deployer_address="$3"
  
  log_section "DEPLOYMENT COMPLETE"
  
  echo "🎉 NeuroWealth Vault deployed successfully to Stellar Devnet!"
  echo ""
  echo "Contract Addresses:"
  echo "  📄 Vault Contract: $vault_address"
  echo "  💰 USDC Token:    $token_address"
  echo "  👤 Deployer:      $deployer_address"
  echo ""
  echo "Network Configuration:"
  echo "  🌐 RPC URL:       $SOROBAN_RPC_URL"
  echo "  🔐 Network:       $SOROBAN_NETWORK_PASSPHRASE"
  echo ""
  echo "Quick Start:"
  echo "  1. Source the contract addresses:"
  echo "     source $CONTRACT_ADDRESSES"
  echo ""
  echo "  2. Check your balance:"
  echo "     stellar contract invoke --id \$VAULT_CONTRACT_ID --source \$SOROBAN_SECRET_KEY --network \$SOROBAN_NETWORK_PASSPHRASE --rpc-url \$SOROBAN_RPC_URL -- -- get_balance --user \$AGENT_ADDRESS"
  echo ""
  echo "  3. Deposit USDC:"
  echo "     stellar contract invoke --id \$VAULT_CONTRACT_ID --source \$SOROBAN_SECRET_KEY --network \$SOROBAN_NETWORK_PASSPHRASE --rpc-url \$SOROBAN_RPC_URL -- deposit --user \$AGENT_ADDRESS --amount 10000000"
  echo ""
  echo "  4. Verify deployment:"
  echo "     ./scripts/verify-deployment.sh"
  echo ""
  echo "Documentation: EVENTS.md"
  echo "Repository: https://github.com/xeladev/neurowealth-smartcontract"
  echo ""
}

# ---------------------------------------------------------------------------
# Main Execution
# ---------------------------------------------------------------------------

main() {
  local force=false
  
  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      --help)
        show_help
        exit 0
        ;;
      --force)
        force=true
        shift
        ;;
      *)
        log "ERROR: Unknown argument: $1"
        show_help
        exit 2
        ;;
    esac
  done
  
  # Start deployment
  log_section "NEUROWEALTH VAULT DEVNET DEPLOYMENT"
  
  # Pre-flight checks
  log "Running pre-flight checks..."
  check_stellar_cli
  check_env
  check_contracts
  
  # Check if already deployed
  if [[ -f "$CONTRACT_ADDRESSES" && "$force" != "true" ]]; then
    log "Contracts already deployed. Use --force to redeploy."
    source "$CONTRACT_ADDRESSES"
    show_summary "$VAULT_CONTRACT_ID" "$USDC_TOKEN_ADDRESS" "$DEPLOYER_ADDRESS"
    exit 0
  fi
  
  # Get deployer address
  log "Getting deployer address..."
  local deployer_address
  deployer_address=$(stellar keys address "$SOROBAN_SECRET_KEY")
  log "Deployer address: $deployer_address"
  
  # Deploy token contract first
  local token_address
  token_address=$(deploy_contract "$TOKEN_WASM_PATH" "USDC Token")
  
  # Deploy vault contract
  local vault_address
  vault_address=$(deploy_contract "$WASM_PATH" "Vault")
  
  # Initialize vault
  initialize_vault "$vault_address" "$token_address" "$deployer_address"
  
  # Mint initial tokens
  mint_initial_tokens "$token_address" "$deployer_address"
  
  # Save addresses
  save_contract_addresses "$vault_address" "$token_address" "$deployer_address"
  
  # Show summary
  show_summary "$vault_address" "$token_address" "$deployer_address"
  
  log "Deployment log saved to: $DEPLOYMENT_LOG"
}

# Run main function
main "$@" | sed 's/S[A-Za-z0-9]\{55\}/[REDACTED_SECRET_KEY]/g' | tee "$DEPLOYMENT_LOG"
