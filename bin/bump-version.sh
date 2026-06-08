#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

PKG_FILE="$PROJECT_DIR/package.json"
PLUGIN_FILE="$PROJECT_DIR/.claude-plugin/plugin.json"
MARKET_FILE="$PROJECT_DIR/.claude-plugin/marketplace.json"
CODEX_PLUGIN_FILE="$PROJECT_DIR/.codex-plugin/plugin.json"

read_version() {
  grep -o '"version": "[^"]*"' "$1" | head -1 | grep -o '[0-9]*\.[0-9]*\.[0-9]*'
}

PKG_VER=$(read_version "$PKG_FILE")
PLUGIN_VER=$(read_version "$PLUGIN_FILE")
MARKET_VER=$(read_version "$MARKET_FILE")
CODEX_VER=$(read_version "$CODEX_PLUGIN_FILE")

# Guard: all manifest files must agree before bumping. A single bump with sed
# only matches files whose version equals the source-of-truth string, so a
# silent desync would otherwise propagate forever (only package.json bumps,
# manifests stay frozen, marketplace keeps shipping the old version).
if [[ "$PKG_VER" != "$PLUGIN_VER" || "$PKG_VER" != "$MARKET_VER" || "$PKG_VER" != "$CODEX_VER" ]]; then
  echo "ERROR: version files are desynced — refusing to bump." >&2
  echo "  package.json                    = $PKG_VER" >&2
  echo "  .claude-plugin/plugin.json      = $PLUGIN_VER" >&2
  echo "  .claude-plugin/marketplace.json = $MARKET_VER" >&2
  echo "  .codex-plugin/plugin.json       = $CODEX_VER" >&2
  echo "" >&2
  echo "Sync them to the same version manually, commit, then re-run bump-version." >&2
  exit 1
fi

CURRENT="$PKG_VER"
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
NEW="$MAJOR.$MINOR.$((PATCH + 1))"

sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" \
  "$PKG_FILE" \
  "$PLUGIN_FILE" \
  "$MARKET_FILE" \
  "$CODEX_PLUGIN_FILE"

# Verify the bump actually landed in every file. Catches the edge case where
# a future edit changes a manifest's "version" line format and silently
# skips the sed replacement.
for f in "$PKG_FILE" "$PLUGIN_FILE" "$MARKET_FILE" "$CODEX_PLUGIN_FILE"; do
  if [[ "$(read_version "$f")" != "$NEW" ]]; then
    echo "ERROR: $f did not bump to $NEW (still $(read_version "$f"))." >&2
    exit 1
  fi
done

git -C "$PROJECT_DIR" add \
  package.json \
  .claude-plugin/plugin.json \
  .claude-plugin/marketplace.json \
  .codex-plugin/plugin.json

echo "Version bumped: $CURRENT → $NEW"
