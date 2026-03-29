#!/usr/bin/env bash
set -euo pipefail

# check-update.sh — Check GitHub Releases for newer plugin version.
# Output: "UPDATE_AVAILABLE <local> <remote>" (exit 0) or "SKIPPED"/"UP_TO_DATE" (exit 1)

# Skip in CI environments
if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ] || [ -n "${JENKINS_URL:-}" ] || [ -n "${BUILDKITE:-}" ] || [ -n "${CIRCLECI:-}" ]; then
  echo "SKIPPED"; exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
CACHE_FILE="${HOME}/.jlu-update-check"
CACHE_TTL=14400  # 4 hours
REPO="cristian-pisco/jelou-spec-plugin"

# Read local version
LOCAL_VERSION=$(grep -o '"version": "[^"]*"' "$PLUGIN_DIR/package.json" | head -1 | grep -o '[0-9]*\.[0-9]*\.[0-9]*')
[ -z "$LOCAL_VERSION" ] && { echo "SKIPPED"; exit 1; }

# Version comparison function
version_gt() {
  IFS='.' read -r L_MAJ L_MIN L_PAT <<< "$1"
  IFS='.' read -r R_MAJ R_MIN R_PAT <<< "$2"
  [ "$R_MAJ" -gt "$L_MAJ" ] 2>/dev/null && return 0
  [ "$R_MAJ" -eq "$L_MAJ" ] && [ "$R_MIN" -gt "$L_MIN" ] 2>/dev/null && return 0
  [ "$R_MAJ" -eq "$L_MAJ" ] && [ "$R_MIN" -eq "$L_MIN" ] && [ "$R_PAT" -gt "$L_PAT" ] 2>/dev/null && return 0
  return 1
}

# Check cache
if [ -f "$CACHE_FILE" ]; then
  NOW=$(date +%s)
  FILE_TIME=$(stat -c %Y "$CACHE_FILE" 2>/dev/null || stat -f %m "$CACHE_FILE" 2>/dev/null || echo "$NOW")
  CACHE_AGE=$(( NOW - FILE_TIME ))
  if [ "$CACHE_AGE" -lt "$CACHE_TTL" ]; then
    CACHED=$(cat "$CACHE_FILE")
    [ "$CACHED" = "SKIP" ] && { echo "SKIPPED"; exit 1; }
    [ "$CACHED" = "$LOCAL_VERSION" ] && { echo "UP_TO_DATE $LOCAL_VERSION"; exit 1; }
    if version_gt "$LOCAL_VERSION" "$CACHED"; then
      echo "UPDATE_AVAILABLE $LOCAL_VERSION $CACHED"
      exit 0
    fi
    echo "UP_TO_DATE $LOCAL_VERSION"
    exit 1
  fi
fi

# Query GitHub Releases API (2s timeout, single request)
REMOTE_VERSION=$(curl -sf --max-time 2 \
  "https://api.github.com/repos/$REPO/releases/latest" \
  2>/dev/null | grep -o '"tag_name": "[^"]*"' | grep -o '[0-9]*\.[0-9]*\.[0-9]*' || true)

# No response — cache SKIP
if [ -z "$REMOTE_VERSION" ]; then
  TMPF=$(mktemp "${CACHE_FILE}.XXXXXX") && echo "SKIP" > "$TMPF" && mv "$TMPF" "$CACHE_FILE" 2>/dev/null || true
  echo "SKIPPED"; exit 1
fi

# Cache remote version (atomic write)
TMPF=$(mktemp "${CACHE_FILE}.XXXXXX") && echo "$REMOTE_VERSION" > "$TMPF" && mv "$TMPF" "$CACHE_FILE" 2>/dev/null || true

# Compare
if version_gt "$LOCAL_VERSION" "$REMOTE_VERSION"; then
  echo "UPDATE_AVAILABLE $LOCAL_VERSION $REMOTE_VERSION"
  exit 0
fi

echo "UP_TO_DATE $LOCAL_VERSION"
exit 1
