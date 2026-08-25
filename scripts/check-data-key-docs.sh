#!/usr/bin/env bash
# check-data-key-docs.sh
#
# Validates that every DataKey variant in lib.rs is documented in the
# ARCHITECTURE.md storage layout table. Prevents documentation drift when
# new storage keys are added or existing ones renamed.
#
# Usage:
#   bash scripts/check-data-key-docs.sh
#
# Exits non-zero if any variant is missing from the docs.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB_RS="$REPO_ROOT/neurowealth-vault/contracts/vault/src/lib.rs"
ARCH_MD="$REPO_ROOT/ARCHITECTURE.md"

if [ ! -f "$LIB_RS" ]; then
  echo "ERROR: lib.rs not found at $LIB_RS" >&2
  exit 1
fi

if [ ! -f "$ARCH_MD" ]; then
  echo "ERROR: ARCHITECTURE.md not found at $ARCH_MD" >&2
  exit 1
fi

# ── 1. Extract variant names from lib.rs ─────────────────────────────────────
# Match lines like:  Balance(Address),  TotalDeposits,  UserStrategy(Address),
# inside the DataKey enum block. We grab the identifier before any '(' or ','.
LIB_VARIANTS=()
IN_ENUM=0
while IFS= read -r line; do
  # Detect start of the DataKey enum
  if echo "$line" | grep -qE '^[[:space:]]*pub[[:space:]]+enum[[:space:]]+DataKey'; then
    IN_ENUM=1
    continue
  fi
  # Detect end of enum
  if [ "$IN_ENUM" -eq 1 ] && echo "$line" | grep -qE '^[[:space:]]*\}'; then
    break
  fi
  if [ "$IN_ENUM" -eq 1 ]; then
    # Extract variant name: PascalCase word at start of line (after whitespace)
    variant=$(echo "$line" | sed -nE 's/^[[:space:]]+([A-Z][A-Za-z0-9_]*).*/\1/p')
    if [ -n "$variant" ]; then
      LIB_VARIANTS+=("$variant")
    fi
  fi
done < "$LIB_RS"

if [ ${#LIB_VARIANTS[@]} -eq 0 ]; then
  echo "ERROR: No DataKey variants found in lib.rs — check the enum definition." >&2
  exit 1
fi

echo "Found ${#LIB_VARIANTS[@]} DataKey variants in lib.rs"

# ── 2. Extract variant names from ARCHITECTURE.md ────────────────────────────
# The documented enum lives in a ```rust code block under "## DataKey Structure".
# We parse lines inside that fenced block.
DOC_VARIANTS=()
IN_BLOCK=0
PAST_HEADER=0
while IFS= read -r line; do
  # Detect the fenced code block start after the DataKey Structure heading
  if echo "$line" | grep -qE '^[[:space:]]*##[[:space:]]+DataKey[[:space:]]+Structure'; then
    PAST_HEADER=1
    continue
  fi
  if [ "$PAST_HEADER" -eq 1 ] && echo "$line" | grep -qE '^[[:space:]]*```'; then
    if [ "$IN_BLOCK" -eq 0 ]; then
      IN_BLOCK=1
      continue
    else
      break  # end of the code block
    fi
  fi
  if [ "$IN_BLOCK" -eq 1 ]; then
    variant=$(echo "$line" | sed -nE 's/^[[:space:]]+([A-Z][A-Za-z0-9_]*).*/\1/p')
    if [ -n "$variant" ]; then
      DOC_VARIANTS+=("$variant")
    fi
  fi
done < "$ARCH_MD"

echo "Found ${#DOC_VARIANTS[@]} DataKey variants in ARCHITECTURE.md"
echo ""

# ── 3. Compare ───────────────────────────────────────────────────────────────
MISSING=()
for v in "${LIB_VARIANTS[@]}"; do
  found=0
  for d in "${DOC_VARIANTS[@]}"; do
    if [ "$v" = "$d" ]; then
      found=1
      break
    fi
  done
  if [ "$found" -eq 0 ]; then
    MISSING+=("$v")
  fi
done

EXTRA=()
for d in "${DOC_VARIANTS[@]}"; do
  found=0
  for v in "${LIB_VARIANTS[@]}"; do
    if [ "$d" = "$v" ]; then
      found=1
      break
    fi
  done
  if [ "$found" -eq 0 ]; then
    EXTRA+=("$d")
  fi
done

# ── 4. Report ────────────────────────────────────────────────────────────────
FAIL=0

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "❌ DataKey variants in lib.rs but MISSING from ARCHITECTURE.md:"
  for v in "${MISSING[@]}"; do
    echo "   - $v"
  done
  FAIL=1
fi

if [ ${#EXTRA[@]} -gt 0 ]; then
  echo "⚠️  DataKey variants in ARCHITECTURE.md but NOT in lib.rs (stale docs?):"
  for v in "${EXTRA[@]}"; do
    echo "   - $v"
  done
  # Extra entries in docs are a warning, not a hard failure — they may
  # represent deprecated variants kept for historical context.
fi

echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "❌ DATAKEY DOCS CHECK FAILED"
  echo "   Add the missing variants to the DataKey Structure section in ARCHITECTURE.md."
  exit 1
else
  echo "✅ DATAKEY DOCS CHECK PASSED — all lib.rs variants are documented in ARCHITECTURE.md"
  exit 0
fi
