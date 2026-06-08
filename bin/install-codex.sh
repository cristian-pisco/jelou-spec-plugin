#!/usr/bin/env bash
set -euo pipefail

# Jelou Spec Plugin - Codex CLI installer
# Installs Codex prompts, subagents (TOML), shared workflows, PreToolUse guards,
# MCP config, and the AGENTS.md rules block.
#
# Usage:
#   bin/install-codex.sh                 # global install into $CODEX_HOME (~/.codex)
#   bin/install-codex.sh <project-dir>   # project install into <project-dir>/.codex

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

if [ "$#" -ge 1 ]; then
  MODE="project"
  PROJECT_DIR="$(cd "$1" && pwd)"
  CODEX_DIR="$PROJECT_DIR/.codex"
  JELOU_DIR="$PROJECT_DIR/jelou"
  BIN_DIR="$PROJECT_DIR/bin"
  CONFIG_FILE="$CODEX_DIR/config.toml"
  HOOKS_FILE="$CODEX_DIR/hooks.json"
  AGENTS_FILE="$PROJECT_DIR/AGENTS.md"
else
  MODE="global"
  CODEX_DIR="$CODEX_HOME"
  JELOU_DIR="$CODEX_HOME/jelou"
  BIN_DIR="$CODEX_HOME/bin"
  CONFIG_FILE="$CODEX_HOME/config.toml"
  HOOKS_FILE="$CODEX_HOME/hooks.json"
  AGENTS_FILE="$CODEX_HOME/AGENTS.md"
fi

if [ ! -d "$PLUGIN_DIR/.codex" ]; then
  echo "Error: .codex directory not found. Run \`node bin/sync-codex.mjs\` first." >&2
  exit 1
fi

echo "=== Jelou Spec Plugin (Codex) Installer — $MODE ==="
echo "Source: $PLUGIN_DIR"
echo "Codex dir: $CODEX_DIR"
echo

mkdir -p "$CODEX_DIR/prompts" "$CODEX_DIR/agents" "$JELOU_DIR" "$BIN_DIR"

cp -R "$PLUGIN_DIR/.codex/prompts/." "$CODEX_DIR/prompts/"
cp -R "$PLUGIN_DIR/.codex/agents/." "$CODEX_DIR/agents/"
cp -R "$PLUGIN_DIR/jelou/." "$JELOU_DIR/"
cp "$PLUGIN_DIR/bin/guard-test-commands.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/guard-env-reads.mjs" "$BIN_DIR/"
echo "Installed Codex prompts, agents, workflows, and guard scripts"

# --- hooks.json: resolve guard paths to the install location ---
cat > "$HOOKS_FILE" <<JSON
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^Bash$",
        "hooks": [
          { "type": "command", "command": "node \"$BIN_DIR/guard-test-commands.mjs\"", "statusMessage": "jlu: checking test-command worker caps" },
          { "type": "command", "command": "node \"$BIN_DIR/guard-env-reads.mjs\"", "statusMessage": "jlu: checking for .env secret exposure" }
        ]
      }
    ]
  }
}
JSON
echo "Wrote $HOOKS_FILE"

# --- config.toml: merge MCP + agent limits idempotently ---
if [ "$MODE" = "project" ]; then
  cp "$PLUGIN_DIR/.codex/config.toml" "$CONFIG_FILE"
  echo "Wrote project $CONFIG_FILE"
else
  touch "$CONFIG_FILE"
  if ! grep -q '\[mcp_servers.context7\]' "$CONFIG_FILE"; then
    cat >> "$CONFIG_FILE" <<'TOML'

# --- jelou-spec-plugin (added by install-codex.sh) ---
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp@latest"]

[agents]
max_threads = 6
max_depth = 1

[features]
hooks = true
# --- end jelou-spec-plugin ---
TOML
    echo "Appended jelou MCP + agent settings to $CONFIG_FILE"
  else
    echo "context7 already configured in $CONFIG_FILE — left untouched"
  fi
  echo
  echo "NOTE: mark this project trusted so its .codex/ layer loads, e.g. in $CONFIG_FILE:"
  echo "  [projects.\"\$(pwd)\"]"
  echo "  trust_level = \"trusted\""
fi

# --- AGENTS.md rules block (idempotent replace) ---
PLUGIN_AGENTS="$PLUGIN_DIR/AGENTS.md"
if [ -f "$PLUGIN_AGENTS" ]; then
  export PLUGIN_AGENTS TARGET_AGENTS="$AGENTS_FILE"
  python3 - <<'PY'
import os, re
from pathlib import Path
plugin_agents = Path(os.environ["PLUGIN_AGENTS"])
target_agents = Path(os.environ["TARGET_AGENTS"])
start, end = "<!-- JELOU_SPEC_PLUGIN_START -->", "<!-- JELOU_SPEC_PLUGIN_END -->"
block = f"{start}\n{plugin_agents.read_text().rstrip()}\n{end}\n"
if target_agents.exists():
    current = target_agents.read_text()
    cleaned = re.sub(re.compile(r"\n?<!-- JELOU_SPEC_PLUGIN_START -->.*?<!-- JELOU_SPEC_PLUGIN_END -->\n?", re.S), "\n", current).rstrip()
    updated = (cleaned + "\n\n" + block) if cleaned else block
else:
    updated = block
target_agents.parent.mkdir(parents=True, exist_ok=True)
target_agents.write_text(updated)
PY
  echo "Updated $AGENTS_FILE with Jelou rules block"
fi

echo
echo "Done. Core commands now available in Codex:"
echo "  /jlu-new-task   /jlu-map-codebase   /jlu-execute-task   /jlu-create-pr"
echo
echo "Note: /jlu-task-clickup and /jlu-daily-slack are Phase 2 (skipped in Phase 1 runs)."
