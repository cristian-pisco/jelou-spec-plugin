#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only trigger on git commit (not amend, not other git commands)
if echo "$COMMAND" | grep -qE '^git commit|&& *git commit'; then
  HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_DIR="$(cd "$HOOK_DIR/../.." && pwd)"
  "$PROJECT_DIR/bin/bump-version.sh"
fi

exit 0
