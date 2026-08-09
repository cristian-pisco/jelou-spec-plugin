#!/usr/bin/env bash
set -euo pipefail

# Jelou Spec Plugin — Fallback Installer
# For users without native plugin support, copies skills and agents
# to the appropriate ~/.claude/ directories.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="${CLAUDE_HOME:-$HOME/.claude}"

echo "=== Jelou Spec Plugin Installer ==="
echo ""
echo "Plugin directory: $PLUGIN_DIR"
echo "Claude directory: $CLAUDE_DIR"
echo ""

# Ensure Claude directory exists
mkdir -p "$CLAUDE_DIR"

# Copy skills
if [ -d "$PLUGIN_DIR/skills" ]; then
  echo "Installing skills..."
  mkdir -p "$CLAUDE_DIR/skills"
  cp -r "$PLUGIN_DIR/skills/"* "$CLAUDE_DIR/skills/"
  echo "  Installed $(find "$PLUGIN_DIR/skills" -name "SKILL.md" | wc -l) skills"
fi

# Copy agents
if [ -d "$PLUGIN_DIR/agents" ]; then
  echo "Installing agents..."
  mkdir -p "$CLAUDE_DIR/agents"
  cp -r "$PLUGIN_DIR/agents/"* "$CLAUDE_DIR/agents/" 2>/dev/null || true
  echo "  Installed $(find "$PLUGIN_DIR/agents" -name "*.md" | wc -l) agents"
fi

# Sync .opencode/agents from agents/ (canonical) so OpenCode users get the
# same content. Non-fatal: install never breaks if Node is missing.
if [ "${JLU_SKIP_SYNC_AGENTS:-false}" != "true" ]; then
  if command -v node >/dev/null 2>&1 && [ -f "$PLUGIN_DIR/bin/sync-agents.mjs" ]; then
    echo "Syncing .opencode/agents from agents/..."
    (cd "$PLUGIN_DIR" && node bin/sync-agents.mjs >/dev/null) \
      || echo "  sync-agents skipped (non-fatal)"
  fi
fi

# Copy update check script
if [ -f "$PLUGIN_DIR/bin/check-update.sh" ]; then
  echo "Installing update check..."
  mkdir -p "$CLAUDE_DIR/bin"
  cp "$PLUGIN_DIR/bin/check-update.sh" "$CLAUDE_DIR/bin/"
  chmod +x "$CLAUDE_DIR/bin/check-update.sh"
  echo "  Installed check-update.sh"
fi

# Copy shared resources
if [ -d "$PLUGIN_DIR/jelou" ]; then
  echo "Installing shared resources..."
  mkdir -p "$CLAUDE_DIR/jelou"
  cp -r "$PLUGIN_DIR/jelou/"* "$CLAUDE_DIR/jelou/"
  echo "  Installed workflows, templates, and references"
fi

echo ""
echo "Installation complete!"
echo ""
echo "Available commands:"
echo "  /jlu:map-codebase    — Analyze a service's codebase"
echo "  /jlu:new-task        — Create a new task"
echo "  /jlu:refine-task     — Apply targeted changes to an approved spec"
echo "  /jlu:ship            — Create pull requests for all affected services"
echo "  /jlu:execute-task    — Run TDD implementation"
echo "  /jlu:sync-clickup    — Sync with ClickUp (via MCP)"
echo "  /jlu:list-tasks      — List local tasks"
echo "  /jlu:load-context    — Load task context for Q&A"
echo "  /jlu:post-slack      — Post daily summary to Slack"
