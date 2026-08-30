#!/usr/bin/env bash
set -euo pipefail

# Jelou Spec Plugin — Legacy Fallback Installer (Claude Code)
#
# Only for a Claude Code too old to support plugins. Everywhere else the plugin
# system owns the install: it namespaces every surface under `jlu:`, loads
# hooks/hooks.json, and replaces the whole tree on update.
#
# This path cannot do any of that. It copies skills and agents into ~/.claude
# under their BARE names, where they shadow the plugin's namespaced surfaces and
# collide with third-party skills of the same name. It installs no hooks at all.
#
# Reach it only through `./setup --host claude --legacy-copy`.
#
# Every run purges the surfaces a previous run installed before copying: without
# that, a skill or agent retired upstream stays resident and dispatchable forever.

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

# A previously installed skill is identified by the workflow reference only this
# plugin emits, never by name — third-party skills share names (gstack ships its
# own `ship`) and must survive untouched.
purge_installed_skills() {
  local dir="$1" removed=0 skill
  [ -d "$dir" ] || return 0
  for skill in "$dir"/*/; do
    [ -f "$skill/SKILL.md" ] || continue
    grep -q 'jelou/workflows/' "$skill/SKILL.md" || continue
    rm -rf "$skill"
    removed=$((removed + 1))
  done
  echo "  Purged $removed previously installed skill(s)"
}

purge_installed_agents() {
  local dir="$1" removed=0 agent
  [ -d "$dir" ] || return 0
  for agent in "$dir"/jlu-*.md; do
    [ -f "$agent" ] || continue
    rm -f "$agent"
    removed=$((removed + 1))
  done
  echo "  Purged $removed previously installed agent(s)"
}

# Bare names collide across sources — gstack ships its own `ship`. Whatever this
# installer did not put there wins; the alternative is silently destroying a
# skill the user installed from somewhere else.
install_skills() {
  local src="$1" dest="$2" installed=0 skipped=0 skill name
  mkdir -p "$dest"
  for skill in "$src"/*/; do
    [ -f "$skill/SKILL.md" ] || continue
    name="$(basename "$skill")"
    if [ -e "$dest/$name" ]; then
      echo "  Skipped $name — a skill from another source already owns that name"
      skipped=$((skipped + 1))
      continue
    fi
    cp -r "$skill" "$dest/$name"
    installed=$((installed + 1))
  done
  echo "  Installed $installed skill(s), skipped $skipped"
}

if [ -d "$PLUGIN_DIR/skills" ]; then
  echo "Installing skills..."
  purge_installed_skills "$CLAUDE_DIR/skills"
  install_skills "$PLUGIN_DIR/skills" "$CLAUDE_DIR/skills"
fi

if [ -d "$PLUGIN_DIR/agents" ]; then
  echo "Installing agents..."
  mkdir -p "$CLAUDE_DIR/agents"
  purge_installed_agents "$CLAUDE_DIR/agents"
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
echo "Installed skills (invoke by bare name in this layout):"
for skill in "$PLUGIN_DIR"/skills/*/; do
  echo "  /$(basename "$skill")"
done
