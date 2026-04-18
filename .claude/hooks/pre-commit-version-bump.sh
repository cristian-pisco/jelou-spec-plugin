#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only trigger on a real `git commit` (not amend, not other git subcommands).
if ! echo "$COMMAND" | grep -qE '(^|[[:space:]]|&&[[:space:]]*)git[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi
if echo "$COMMAND" | grep -qE '(^|[[:space:]])--amend([[:space:]]|=|$)'; then
  exit 0
fi

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$HOOK_DIR/../.." && pwd)"
export PROJECT_DIR

# changelog-entry.py bumps the patch version in all three manifest files,
# prepends a categorized entry to CHANGELOG.md, and stages everything. It
# exits 2 if it cannot parse the commit message, which blocks the commit so
# the CHANGELOG and version can never drift apart.
echo "$COMMAND" | python3 "$PROJECT_DIR/bin/changelog-entry.py"
