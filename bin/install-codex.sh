#!/usr/bin/env bash
set -euo pipefail

# Jelou Spec Plugin - Codex CLI installer
# Installs Codex skills, subagents (TOML), shared workflows, PreToolUse guards,
# MCP config, TUI status line, and the AGENTS.md rules block.
#
# Usage:
#   bin/install-codex.sh                 # global install: skills into ~/.agents/skills, rest into $CODEX_HOME (~/.codex)
#   bin/install-codex.sh <project-dir>   # project install: skills into <project-dir>/.agents/skills, rest into <project-dir>/.codex
#
# CODEX_SKILLS_DIR overrides the global skill destination (~/.agents/skills).

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
  SKILLS_DIR="$PROJECT_DIR/.agents/skills"
else
  MODE="global"
  CODEX_DIR="$CODEX_HOME"
  JELOU_DIR="$CODEX_HOME/jelou"
  BIN_DIR="$CODEX_HOME/bin"
  CONFIG_FILE="$CODEX_HOME/config.toml"
  HOOKS_FILE="$CODEX_HOME/hooks.json"
  AGENTS_FILE="$CODEX_HOME/AGENTS.md"
  SKILLS_DIR="${CODEX_SKILLS_DIR:-$HOME/.agents/skills}"
fi

for mirror in skills agents; do
  if [ ! -d "$PLUGIN_DIR/.codex/$mirror" ] || [ -z "$(ls -A "$PLUGIN_DIR/.codex/$mirror" 2>/dev/null)" ]; then
    echo "Error: .codex/$mirror is missing or empty. Run \`node bin/sync-codex.mjs\` first." >&2
    exit 1
  fi
done

echo "=== Jelou Spec Plugin (Codex) Installer — $MODE ==="
echo "Source: $PLUGIN_DIR"
echo "Codex dir: $CODEX_DIR"
echo

mkdir -p "$CODEX_DIR/agents" "$SKILLS_DIR" "$JELOU_DIR/bin" "$BIN_DIR"

cp -R "$PLUGIN_DIR/.codex/skills/." "$SKILLS_DIR/"
for installed_skill in "${SKILLS_DIR:?}"/jlu-*; do
  [ -d "$installed_skill" ] || continue
  [ -d "$PLUGIN_DIR/.codex/skills/$(basename "$installed_skill")" ] || rm -rf "$installed_skill"
done
cp -R "$PLUGIN_DIR/.codex/agents/." "$CODEX_DIR/agents/"
for installed_agent in "$CODEX_DIR/agents"/jlu-*.toml; do
  [ -f "$installed_agent" ] || continue
  [ -f "$PLUGIN_DIR/.codex/agents/$(basename "$installed_agent")" ] || rm -f "$installed_agent"
done

rm -f "$CODEX_DIR/prompts/"jlu-*.md 2>/dev/null || true
rmdir "$CODEX_DIR/prompts" 2>/dev/null || true
cp -R "$PLUGIN_DIR/jelou/." "$JELOU_DIR/"
cp "$PLUGIN_DIR/bin/jlu-update.sh" "$JELOU_DIR/bin/"
chmod +x "$JELOU_DIR/bin/jlu-update.sh"
cp "$PLUGIN_DIR/bin/guard-test-commands.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/guard-env-reads.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/head-sha-guard.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/derive-dev-block.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/verify-dev-block.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/list-tasks.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/task-index.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/boot-dev-server.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/build-boot-plan.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/classify-e2e-target.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/classify-task-scope.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/detect-auth-collapse.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/e2e-ensure-account.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/e2e-login-local.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/e2e-login.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/e2e-session-probe.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/e2e-session-sync.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/extract-trace.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/parse-goal-matrix.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/probe-coverage-breadth.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/seed-e2e-settings.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/daily-slack-assemble.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/daily-slack-bucket.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/daily-slack-compose.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/daily-slack-extract-reason.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/daily-slack-render.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/daily-slack-scan-urls.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/install-dep.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/jlu-settings.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/plan-phase-waves.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/runtime-exec.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/trace-end-span.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/trace-eval.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/trace-export-otlp.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/trace-feedback.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/trace-reconcile.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/trace-snapshot-task.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/trace-start-span.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/trace-suggest.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/validate-stories.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/architecture-review-allocate-adr.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/architecture-review-render.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/compile-registry.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/council.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/glossary-merge.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/investigate.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/seed-registry.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/trace-analyze.mjs" "$BIN_DIR/"
cp "$PLUGIN_DIR/bin/trace-eval-report.mjs" "$BIN_DIR/"
mkdir -p "$BIN_DIR/lib/dev-orchestrator/stack" "$BIN_DIR/lib/registry" "$BIN_DIR/lib/boot-engine" "$BIN_DIR/lib/task-index" "$BIN_DIR/lib/trace"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/notify.mjs" "$BIN_DIR/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/readiness.mjs" "$BIN_DIR/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/override.mjs" "$BIN_DIR/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/ports.mjs" "$BIN_DIR/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/resolve-base-image.mjs" "$BIN_DIR/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/wiring.mjs" "$BIN_DIR/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/registry/yaml-lite.mjs" "$BIN_DIR/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/registry/splice.mjs" "$BIN_DIR/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/registry/read.mjs" "$BIN_DIR/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/boot-engine/execute-shared-reuse.mjs" "$BIN_DIR/lib/boot-engine/"
cp "$PLUGIN_DIR/bin/lib/boot-engine/env-mask.mjs" "$BIN_DIR/lib/boot-engine/"
cp "$PLUGIN_DIR/bin/lib/boot-engine/plan.mjs" "$BIN_DIR/lib/boot-engine/"
cp "$PLUGIN_DIR/bin/lib/task-index/extract.mjs" "$BIN_DIR/lib/task-index/"
cp "$PLUGIN_DIR/bin/lib/task-index/scan.mjs" "$BIN_DIR/lib/task-index/"
cp "$PLUGIN_DIR/bin/lib/task-index/render.mjs" "$BIN_DIR/lib/task-index/"
cp "$PLUGIN_DIR/bin/lib/task-index/workspace.mjs" "$BIN_DIR/lib/task-index/"
cp "$PLUGIN_DIR/bin/lib/api-login.mjs" "$BIN_DIR/lib/"
cp "$PLUGIN_DIR/bin/lib/e2e-auth.mjs" "$BIN_DIR/lib/"
cp "$PLUGIN_DIR/bin/lib/env-files.mjs" "$BIN_DIR/lib/"
cp "$PLUGIN_DIR/bin/lib/session-sync.mjs" "$BIN_DIR/lib/"
cp "$PLUGIN_DIR/bin/lib/settings-store.mjs" "$BIN_DIR/lib/"
cp "$PLUGIN_DIR/bin/lib/daily-slack-helpers.mjs" "$BIN_DIR/lib/"
cp "$PLUGIN_DIR/bin/lib/daily-slack-status.mjs" "$BIN_DIR/lib/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/config.mjs" "$BIN_DIR/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/workspace.mjs" "$BIN_DIR/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/install-dep.mjs" "$BIN_DIR/lib/"
cp "$PLUGIN_DIR/bin/lib/openrouter.mjs" "$BIN_DIR/lib/"
cp "$PLUGIN_DIR/bin/lib/runtime-exec.mjs" "$BIN_DIR/lib/"
cp "$PLUGIN_DIR/bin/lib/trace/aggregate.mjs" "$BIN_DIR/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/cost.mjs" "$BIN_DIR/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/emitter.mjs" "$BIN_DIR/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/failure.mjs" "$BIN_DIR/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/feedback.mjs" "$BIN_DIR/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/otlp.mjs" "$BIN_DIR/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/reader.mjs" "$BIN_DIR/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/rubric.mjs" "$BIN_DIR/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/rules.mjs" "$BIN_DIR/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/schema.mjs" "$BIN_DIR/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/verify.mjs" "$BIN_DIR/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/registry/normalize.mjs" "$BIN_DIR/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/registry/resolve-path.mjs" "$BIN_DIR/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/trace/scorecard.mjs" "$BIN_DIR/lib/trace/"
echo "Installed Codex skills (→ $SKILLS_DIR), agents, workflows, updater, and guard scripts"

ensure_context_status_line() {
  local target_config="$1"
  export TARGET_CONFIG="$target_config"
  python3 - <<'PY'
import os
import re
from pathlib import Path

path = Path(os.environ["TARGET_CONFIG"])
text = path.read_text() if path.exists() else ""
lines = text.splitlines()
status_line = 'status_line = ["model-with-reasoning", "context-remaining", "current-dir"]'

tui_start = None
for idx, line in enumerate(lines):
    if line.strip() == "[tui]":
        tui_start = idx
        break

if tui_start is None:
    updated = text.rstrip()
    if updated:
        updated += "\n\n"
    updated += "[tui]\n" + status_line + "\n"
    path.write_text(updated)
    raise SystemExit

tui_end = len(lines)
for idx in range(tui_start + 1, len(lines)):
    stripped = lines[idx].strip()
    if stripped.startswith("[") and stripped.endswith("]"):
        tui_end = idx
        break

status_start = None
for idx in range(tui_start + 1, tui_end):
    if re.match(r"\s*status_line\s*=", lines[idx]):
        status_start = idx
        break

if status_start is None:
    lines.insert(tui_start + 1, status_line)
    path.write_text("\n".join(lines) + "\n")
    raise SystemExit

status_end = status_start
while status_end + 1 < tui_end and "]" not in lines[status_end]:
    status_end += 1

block = "\n".join(lines[status_start : status_end + 1])
items = re.findall(r"['\"]([^'\"]+)['\"]", block)

if "context-remaining" not in items:
    if items:
        items.insert(1, "context-remaining")
    else:
        items = ["model-with-reasoning", "context-remaining", "current-dir"]
    indent = re.match(r"(\s*)", lines[status_start]).group(1)
    replacement = indent + "status_line = [" + ", ".join(f'"{item}"' for item in items) + "]"
    lines[status_start : status_end + 1] = [replacement]
    path.write_text("\n".join(lines) + "\n")
elif text and not text.endswith("\n"):
    path.write_text(text + "\n")
PY
}

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
    ],
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \"$BIN_DIR/seed-e2e-settings.mjs\"", "statusMessage": "jlu: ensuring ~/.jlu/e2e-settings.json exists" }
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
  ensure_context_status_line "$CONFIG_FILE"
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
  ensure_context_status_line "$CONFIG_FILE"
  echo "Ensured Codex TUI status line shows context remaining in $CONFIG_FILE"
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
echo "Done. Core skills now available in Codex (invoke with \$ or implicitly):"
echo "  \$jlu-new-task   \$jlu-map-codebase   \$jlu-load-context   \$jlu-execute-task   \$jlu-ship"
echo "Restart Codex so it loads the new skills from $SKILLS_DIR."
echo
echo "Note: /jlu-task-clickup and /jlu-daily-slack are Phase 2 (skipped in Phase 1 runs)."
