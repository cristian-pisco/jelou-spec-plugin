#!/usr/bin/env bash
# Configure this clone to use the tracked .githooks/ directory.
# Wired into npm's "prepare" lifecycle so a maintainer clone gets the hook
# active on the first `npm install`. Silently no-ops when run outside a
# git checkout (e.g., when installed as an npm dependency from a tarball).
set -euo pipefail

if ! PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  exit 0
fi

if [ ! -d "$PROJECT_DIR/.githooks" ]; then
  exit 0
fi

git -C "$PROJECT_DIR" config core.hooksPath .githooks
chmod +x "$PROJECT_DIR/.githooks"/* 2>/dev/null || true
echo "git hooks installed: core.hooksPath = .githooks"
