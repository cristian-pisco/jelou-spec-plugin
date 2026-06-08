#!/usr/bin/env bash
set -euo pipefail

# Jelou Spec Plugin - OpenCode installer
# Installs/updates .opencode commands+agents and jelou workflows into a target repo.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
TARGET_DIR="${1:-$PWD}"

if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: target directory does not exist: $TARGET_DIR" >&2
  exit 1
fi

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

if [ ! -d "$PLUGIN_DIR/.opencode" ]; then
  echo "Error: .opencode directory not found in plugin source: $PLUGIN_DIR/.opencode" >&2
  exit 1
fi

if [ ! -d "$PLUGIN_DIR/jelou" ]; then
  echo "Error: jelou directory not found in plugin source: $PLUGIN_DIR/jelou" >&2
  exit 1
fi

echo "=== Jelou Spec Plugin (OpenCode) Installer ==="
echo "Source: $PLUGIN_DIR"
echo "Target: $TARGET_DIR"
echo

mkdir -p "$TARGET_DIR/.opencode"
mkdir -p "$TARGET_DIR/jelou"

cp -R "$PLUGIN_DIR/.opencode/." "$TARGET_DIR/.opencode/"
cp -R "$PLUGIN_DIR/jelou/." "$TARGET_DIR/jelou/"

# The OpenCode guard plugin (.opencode/plugins/guard.ts) imports the pure
# classifiers from ../../bin/guard-*.mjs. Ship them so the import resolves
# post-install (they depend only on Node built-ins).
mkdir -p "$TARGET_DIR/bin"
cp "$PLUGIN_DIR/bin/guard-test-commands.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/guard-env-reads.mjs" "$TARGET_DIR/bin/"

# Global OpenCode config uses root-level commands/ and agents/.
# Keep those mirrors in sync when TARGET_DIR looks like OPENCODE_HOME.
if [ -f "$TARGET_DIR/opencode.json" ]; then
  mkdir -p "$TARGET_DIR/commands"
  mkdir -p "$TARGET_DIR/agents"
  cp -R "$PLUGIN_DIR/.opencode/commands/." "$TARGET_DIR/commands/"
  cp -R "$PLUGIN_DIR/.opencode/agents/." "$TARGET_DIR/agents/"
  echo "Synced OpenCode root command/agent mirrors"
fi

echo "Installed OpenCode command/agent files"
echo "Installed jelou workflows/templates/references"

PLUGIN_AGENTS="$PLUGIN_DIR/AGENTS.md"
TARGET_AGENTS="$TARGET_DIR/AGENTS.md"

if [ -f "$PLUGIN_AGENTS" ]; then
  export PLUGIN_AGENTS
  export TARGET_AGENTS
  python - <<'PY'
import os
import re
from pathlib import Path

plugin_agents = Path(os.environ["PLUGIN_AGENTS"])
target_agents = Path(os.environ["TARGET_AGENTS"])

start = "<!-- JELOU_SPEC_PLUGIN_START -->"
end = "<!-- JELOU_SPEC_PLUGIN_END -->"

plugin_text = plugin_agents.read_text().rstrip() + "\n"
block = f"{start}\n{plugin_text}{end}\n"

if target_agents.exists():
    current = target_agents.read_text()
    pattern = re.compile(r"\n?<!-- JELOU_SPEC_PLUGIN_START -->.*?<!-- JELOU_SPEC_PLUGIN_END -->\n?", re.S)
    cleaned = re.sub(pattern, "\n", current).rstrip()
    if cleaned:
        updated = cleaned + "\n\n" + block
    else:
        updated = block
else:
    updated = block

target_agents.write_text(updated)
PY
  echo "Updated AGENTS.md with Jelou OpenCode rules block"
else
  echo "Warning: plugin AGENTS.md not found, skipping AGENTS rule injection"
fi

echo
echo "Done. Open your target repo and run:"
echo "  opencode"
echo
echo "Core commands now available:"
echo "  /jlu-new-task"
echo "  /jlu-map-codebase"
echo "  /jlu-execute-task"
echo "  /jlu-create-pr"
echo
echo "Note: /jlu-sync-clickup and /jlu-post-slack are Phase 2 placeholders."
