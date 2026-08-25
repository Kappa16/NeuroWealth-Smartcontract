#!/usr/bin/env bash
# check-access-control.sh
#
# Verifies that the access control table in SECURITY.md is accurate and
# complete by cross-referencing it against the function definitions in
# contract-spec.json.
#
# Usage:
#   bash scripts/check-access-control.sh [security_md_path] [spec_path]
#
# Defaults:
#   SECURITY.md       (repo root)
#   contract-spec.json (repo root)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SECURITY_MD="${1:-$REPO_ROOT/SECURITY.md}"
SPEC_JSON="${2:-$REPO_ROOT/contract-spec.json}"

PASS=0
FAIL=0
WARN=0

pass() { echo "  ✅ PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  ❌ FAIL: $1"; FAIL=$((FAIL + 1)); }
warn() { echo "  ⚠️  WARN: $1"; WARN=$((WARN + 1)); }

echo "=== ACCESS CONTROL TABLE ACCURACY CHECK ==="
echo "SECURITY.md: $SECURITY_MD"
echo "Contract spec: $SPEC_JSON"
echo ""

# ── 1. Parse the access control table from SECURITY.md ──────────────────────
echo "1. Parsing access control table from SECURITY.md..."

# Extract the markdown table rows between the header separator lines.
# The table format is:
# | function_name | ✅ or - | ✅ or - | ✅ or - | ✅ or - |
# Columns: Function | Owner | Agent | User | Anyone

# Use Python to parse the markdown table into a mapping
SECURITY_ACCESS=$(python3 - "$SECURITY_MD" <<'PYEOF'
import re
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    content = f.read()

# Find the access control table between the header row and the next section
in_table = False
table_lines = []
for line in content.splitlines():
    stripped = line.strip()
    if stripped.startswith("| Function"):
        in_table = True
        continue
    if in_table:
        if stripped.startswith("|---") or stripped.startswith("| ---"):
            continue  # skip separator
        if stripped.startswith("|") and not stripped.startswith("| Function"):
            table_lines.append(stripped)
        else:
            break  # end of table

# Parse each table row
functions = {}
for line in table_lines:
    cells = [c.strip() for c in line.split("|")]
    cells = [c for c in cells if c]  # remove empty strings from leading/trailing |
    if len(cells) < 5:
        continue
    func_name = cells[0].strip()
    owner = "yes" if cells[1].strip() in ("yes", "✅") else "no"
    agent = "yes" if cells[2].strip() in ("yes", "✅") else "no"
    user = "yes" if cells[3].strip() in ("yes", "✅") else "no"
    anyone = cells[4].strip() if cells[4].strip() not in ("-", "no", "") else ""

    # Determine the canonical access level
    if anyone == "pending owner":
        access = "pending-owner"
    elif anyone == "anyone":
        access = "anyone"
    elif owner == "yes":
        access = "owner"
    elif agent == "yes":
        access = "agent"
    elif user == "yes":
        access = "user"
    else:
        access = "unknown"

    functions[func_name] = access

import json
print(json.dumps(functions))
PYEOF
)

echo "  Found $(echo "$SECURITY_ACCESS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0) functions in SECURITY.md table"

# ── 2. Parse contract-spec.json ─────────────────────────────────────────────
echo ""
echo "2. Parsing contract-spec.json..."

SPEC_ACCESS=$(python3 - "$SPEC_JSON" <<'PYEOF'
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    spec = json.load(f)

# Only check state-changing functions (queries are implicitly public/read-only
# and don't need access control rows).
# Also skip "initialize" since it's a one-time function with special semantics.
SKIP_NAMES = {"initialize"}

functions = {}
for fn in spec.get("functions", []):
    name = fn["name"]
    if name in SKIP_NAMES:
        continue
    if not fn.get("state_changing", False):
        continue  # skip query-only functions

    raw_access = fn.get("access", "unknown")
    requires_auth = fn.get("requires_auth", True)

    # Map spec access to canonical form
    if raw_access == "owner-only":
        access = "owner"
    elif raw_access == "agent-only":
        access = "agent"
    elif raw_access == "pending-owner-only":
        access = "pending-owner"
    elif raw_access == "public":
        # "public" in the spec means anyone can call it.
        # Distinguish between auth-required and permissionless.
        if requires_auth:
            access = "user"  # requires user's signature
        else:
            access = "anyone"  # no auth needed
    else:
        access = raw_access

    functions[name] = access

print(json.dumps(functions))
PYEOF
)

echo "  Found $(echo "$SPEC_ACCESS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0) functions in contract-spec.json"

# ── 3. Cross-reference ──────────────────────────────────────────────────────
echo ""
echo "3. Cross-referencing tables..."

python3 - "$SECURITY_ACCESS" "$SPEC_ACCESS" <<'PYEOF'
import json
import sys

security = json.loads(sys.argv[1])
spec = json.loads(sys.argv[2])

missing_in_security = []
access_mismatches = []
extra_in_security = []

# Check: every state-changing function in spec should be in SECURITY.md
for func_name, spec_access in sorted(spec.items()):
    if func_name not in security:
        missing_in_security.append((func_name, spec_access))
    else:
        sec_access = security[func_name]
        if sec_access != spec_access:
            access_mismatches.append((func_name, spec_access, sec_access))

# Check: every function in SECURITY.md should be in spec
for func_name in sorted(security.keys()):
    if func_name not in spec:
        extra_in_security.append(func_name)

# Report results
if missing_in_security:
    print("MISSING FROM SECURITY.md:")
    for name, access in missing_in_security:
        print(f"  - {name} (spec access: {access})")
    print()

if access_mismatches:
    print("ACCESS LEVEL MISMATCHES:")
    for name, spec_acc, sec_acc in access_mismatches:
        print(f"  - {name}: spec={spec_acc}, SECURITY.md={sec_acc}")
    print()

if extra_in_security:
    print("EXTRA IN SECURITY.md (not in spec):")
    for name in extra_in_security:
        print(f"  - {name}")
    print()

# Exit code
if missing_in_security or access_mismatches:
    sys.exit(1)
else:
    print("All state-changing functions match.")
    sys.exit(0)
PYEOF

CHECK_EXIT=$?

# ── 4. Summary stats ────────────────────────────────────────────────────────
echo ""
echo "4. Statistics..."

SPEC_TOTAL=$(echo "$SPEC_ACCESS" | python3 -c "import json, sys; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "?")
SEC_TOTAL=$(echo "$SECURITY_ACCESS" | python3 -c "import json, sys; print(len(json.loads(sys.stdin.read())))" 2>/dev/null || echo "?")
echo "  State-changing functions in spec: $SPEC_TOTAL"
echo "  Functions in SECURITY.md table:  $SEC_TOTAL"

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "=== Summary ==="
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "  Warnings: $WARN"
echo ""

if [ "$CHECK_EXIT" -ne 0 ] || [ "$FAIL" -gt 0 ]; then
  echo "❌ ACCESS CONTROL CHECK FAILED"
  echo "   The SECURITY.md access control table is stale or inaccurate."
  echo "   Update the table to match contract-spec.json, or update the spec."
  exit 1
else
  echo "✅ ACCESS CONTROL CHECK PASSED"
  exit 0
fi
