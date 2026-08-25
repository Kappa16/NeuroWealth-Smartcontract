#!/usr/bin/env bash
# =============================================================================
# NeuroWealth Vault — E2E Testnet State Cleanup / Restore Helper
# =============================================================================
#
# Cleans up local state left behind by e2e-devnet.sh:
#   - Removes generated CLI identities (e2e-deployer, e2e-user)
#   - Removes artifact files
#
# NOTE: On-chain testnet state cannot be deleted.  This script only removes
# local CLI state so subsequent E2E runs start fresh.  Stellar testnet is
# periodically reset by the SDF, so stale contracts will be cleaned up
# automatically.
#
# Usage:
#   ./scripts/e2e-restore.sh [--keep-artifacts]
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACTS_DIR="$SCRIPT_DIR/e2e-artifacts"

KEEP_ARTIFACTS=false
for arg in "$@"; do
  case "$arg" in
    --keep-artifacts) KEEP_ARTIFACTS=true ;;
    -h|--help)
      echo "Usage: $0 [--keep-artifacts]"
      echo ""
      echo "Cleans up local E2E test state (identities, artifacts)."
      echo ""
      echo "Options:"
      echo "  --keep-artifacts   Do not delete the e2e-artifacts/ directory"
      echo "  -h, --help         Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg"
      exit 1
      ;;
  esac
done

# Detect CLI
if command -v stellar &>/dev/null; then
  CLI="stellar"
elif command -v soroban &>/dev/null; then
  CLI="soroban"
else
  echo "Warning: Neither stellar nor soroban CLI found. Skipping identity cleanup."
  CLI=""
fi

echo "=== NeuroWealth E2E Cleanup ==="
echo ""

# ---------------------------------------------------------------------------
# Remove CLI identities
# ---------------------------------------------------------------------------

IDENTITIES=("e2e-deployer" "e2e-user" "e2e-new-agent")

for id in "${IDENTITIES[@]}"; do
  if [[ -n "$CLI" ]]; then
    if $CLI keys rm "$id" 2>/dev/null; then
      echo "Removed identity: $id"
    else
      echo "Identity not found (already clean): $id"
    fi
  fi
done

# ---------------------------------------------------------------------------
# Remove artifacts
# ---------------------------------------------------------------------------

if [[ "$KEEP_ARTIFACTS" == "true" ]]; then
  echo ""
  echo "Keeping artifacts at: $ARTIFACTS_DIR"
else
  if [[ -d "$ARTIFACTS_DIR" ]]; then
    rm -rf "$ARTIFACTS_DIR"
    echo ""
    echo "Removed artifacts directory: $ARTIFACTS_DIR"
  else
    echo ""
    echo "No artifacts directory to remove."
  fi
fi

echo ""
echo "Cleanup complete."
echo ""
echo "NOTE: On-chain testnet state (deployed contracts, transactions) cannot"
echo "be deleted. Stellar testnet is periodically reset by the SDF."
