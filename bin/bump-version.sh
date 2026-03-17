#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Read current version from package.json
CURRENT=$(grep -o '"version": "[^"]*"' "$PROJECT_DIR/package.json" | head -1 | grep -o '[0-9]*\.[0-9]*\.[0-9]*')

# Bump patch: 0.2.0 → 0.2.1
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
NEW="$MAJOR.$MINOR.$((PATCH + 1))"

# Update all 3 version files
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW\"/" \
  "$PROJECT_DIR/package.json" \
  "$PROJECT_DIR/.claude-plugin/plugin.json" \
  "$PROJECT_DIR/.claude-plugin/marketplace.json"

# Stage the changes
git -C "$PROJECT_DIR" add \
  package.json \
  .claude-plugin/plugin.json \
  .claude-plugin/marketplace.json

echo "Version bumped: $CURRENT → $NEW"
