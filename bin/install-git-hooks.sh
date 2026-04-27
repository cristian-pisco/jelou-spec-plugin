#!/usr/bin/env bash
# Configure this clone to use the tracked .githooks/ directory.
# Run once after cloning the repo.
set -euo pipefail

PROJECT_DIR="$(git rev-parse --show-toplevel)"
git -C "$PROJECT_DIR" config core.hooksPath .githooks
chmod +x "$PROJECT_DIR/.githooks"/*
echo "git hooks installed: core.hooksPath = .githooks"
