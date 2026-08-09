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
mkdir -p "$TARGET_DIR/jelou/bin"

cp -R "$PLUGIN_DIR/.opencode/." "$TARGET_DIR/.opencode/"
cp -R "$PLUGIN_DIR/jelou/." "$TARGET_DIR/jelou/"
cp "$PLUGIN_DIR/bin/jlu-update.sh" "$TARGET_DIR/jelou/bin/"
chmod +x "$TARGET_DIR/jelou/bin/jlu-update.sh"

# The OpenCode guard plugin (.opencode/plugins/guard.ts) imports the pure
# classifiers from ../../bin/guard-*.mjs. Ship them so the import resolves
# post-install (they depend only on Node built-ins).
mkdir -p "$TARGET_DIR/bin"
cp "$PLUGIN_DIR/bin/guard-test-commands.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/guard-env-reads.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/head-sha-guard.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/derive-dev-block.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/verify-dev-block.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/list-tasks.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/local-auth-onboarding.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/local-stack-e2e.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/local-test-data-cleanup.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/task-index.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/boot-dev-server.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/build-boot-plan.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/boot-stack.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/reconcile-stack-run.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/build-dispatch-prompt.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/classify-e2e-target.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/classify-task-scope.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/classify-phase.sh" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/classify-ignored-suite.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/detect-auth-collapse.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/e2e-ensure-account.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/e2e-login-local.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/e2e-login.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/e2e-session-probe.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/e2e-app-mount-probe.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/e2e-session-sync.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/extract-doc-sections.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/extract-trace.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/finalize-phase.sh" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/format-changed-files.sh" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/parse-goal-matrix.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/phase-state.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/probe-coverage-breadth.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/resolve-affected-tests.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/seed-e2e-settings.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/daily-slack-assemble.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/daily-slack-bucket.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/daily-slack-compose.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/daily-slack-extract-reason.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/daily-slack-format-meetings.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/daily-slack-meetings-window.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/daily-slack-render.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/daily-slack-scan-urls.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/install-dep.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/jlu-settings.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/plan-phase-waves.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/runtime-exec.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/trace-end-span.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/trace-eval.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/trace-export-otlp.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/trace-feedback.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/trace-reconcile.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/trace-snapshot-task.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/trace-start-span.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/trace-suggest.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/validate-stories.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/architecture-review-allocate-adr.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/architecture-review-render.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/compile-registry.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/council.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/glossary-merge.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/investigate.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/seed-registry.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/trace-analyze.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/trace-eval-report.mjs" "$TARGET_DIR/bin/"
chmod +x "$TARGET_DIR/bin/classify-phase.sh" "$TARGET_DIR/bin/finalize-phase.sh" "$TARGET_DIR/bin/format-changed-files.sh"
mkdir -p "$TARGET_DIR/bin/lib/dev-orchestrator/stack" "$TARGET_DIR/bin/lib/registry" "$TARGET_DIR/bin/lib/boot-engine" "$TARGET_DIR/bin/lib/task-index" "$TARGET_DIR/bin/lib/trace"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/notify.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/readiness.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/events.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/state.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/override.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/ports.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/resolve-base-image.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/resolve-compose-mounts.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/resolve-network-alias.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/wiring.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/frontend-env.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/e2e-env.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/stack-state.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/auth-cookie-state.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/auth-runtime.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/auth-session.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/auth-urls.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/login-cookie.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/local-onboarding.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/local-keyring.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/local-target.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/local-provisioning.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/local-jelou-provisioning-adapter.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/local-stack-e2e-config.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/local-stack-e2e-adapter.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/local-stack-driver.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/boot-engine/host-map.mjs" "$TARGET_DIR/bin/lib/boot-engine/"
cp "$PLUGIN_DIR/bin/rewrite-e2e-env.mjs" "$TARGET_DIR/bin/"
cp "$PLUGIN_DIR/bin/lib/registry/yaml-lite.mjs" "$TARGET_DIR/bin/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/registry/splice.mjs" "$TARGET_DIR/bin/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/registry/read.mjs" "$TARGET_DIR/bin/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/registry/package-manager.mjs" "$TARGET_DIR/bin/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/registry/validate-dev-commands.mjs" "$TARGET_DIR/bin/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/registry/merge-dev-blocks.mjs" "$TARGET_DIR/bin/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/registry/id-divergence.mjs" "$TARGET_DIR/bin/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/boot-engine/execute-shared-reuse.mjs" "$TARGET_DIR/bin/lib/boot-engine/"
cp "$PLUGIN_DIR/bin/lib/boot-engine/boot-plan-runner.mjs" "$TARGET_DIR/bin/lib/boot-engine/"
cp "$PLUGIN_DIR/bin/lib/boot-engine/execute.mjs" "$TARGET_DIR/bin/lib/boot-engine/"
cp "$PLUGIN_DIR/bin/lib/boot-engine/env-mask.mjs" "$TARGET_DIR/bin/lib/boot-engine/"
cp "$PLUGIN_DIR/bin/lib/boot-engine/deps-provision.mjs" "$TARGET_DIR/bin/lib/boot-engine/"
cp "$PLUGIN_DIR/bin/lib/boot-engine/launcher.mjs" "$TARGET_DIR/bin/lib/boot-engine/"
cp "$PLUGIN_DIR/bin/lib/boot-engine/plan.mjs" "$TARGET_DIR/bin/lib/boot-engine/"
cp "$PLUGIN_DIR/bin/lib/task-index/extract.mjs" "$TARGET_DIR/bin/lib/task-index/"
cp "$PLUGIN_DIR/bin/lib/task-index/scan.mjs" "$TARGET_DIR/bin/lib/task-index/"
cp "$PLUGIN_DIR/bin/lib/task-index/render.mjs" "$TARGET_DIR/bin/lib/task-index/"
cp "$PLUGIN_DIR/bin/lib/task-index/workspace.mjs" "$TARGET_DIR/bin/lib/task-index/"
cp "$PLUGIN_DIR/bin/lib/api-login.mjs" "$TARGET_DIR/bin/lib/"
cp "$PLUGIN_DIR/bin/lib/e2e-auth.mjs" "$TARGET_DIR/bin/lib/"
cp "$PLUGIN_DIR/bin/lib/env-files.mjs" "$TARGET_DIR/bin/lib/"
cp "$PLUGIN_DIR/bin/lib/app-mount.mjs" "$TARGET_DIR/bin/lib/"
cp "$PLUGIN_DIR/bin/lib/session-sync.mjs" "$TARGET_DIR/bin/lib/"
cp "$PLUGIN_DIR/bin/lib/settings-store.mjs" "$TARGET_DIR/bin/lib/"
cp "$PLUGIN_DIR/bin/lib/daily-slack-helpers.mjs" "$TARGET_DIR/bin/lib/"
cp "$PLUGIN_DIR/bin/lib/daily-slack-status.mjs" "$TARGET_DIR/bin/lib/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/config.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/workspace.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/task-context.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/task-source.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/source-mode.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/add.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/daemon.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/daemon-spawn.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/patterns-matcher.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/start.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stop.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/state-daemon.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/tmux.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/compose-down.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/stack-teardown.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/dev-orchestrator/stack/teardown-plan.mjs" "$TARGET_DIR/bin/lib/dev-orchestrator/stack/"
cp "$PLUGIN_DIR/bin/lib/install-dep.mjs" "$TARGET_DIR/bin/lib/"
cp "$PLUGIN_DIR/bin/lib/openrouter.mjs" "$TARGET_DIR/bin/lib/"
cp "$PLUGIN_DIR/bin/lib/runtime-exec.mjs" "$TARGET_DIR/bin/lib/"
cp "$PLUGIN_DIR/bin/lib/trace/aggregate.mjs" "$TARGET_DIR/bin/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/cost.mjs" "$TARGET_DIR/bin/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/emitter.mjs" "$TARGET_DIR/bin/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/failure.mjs" "$TARGET_DIR/bin/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/feedback.mjs" "$TARGET_DIR/bin/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/otlp.mjs" "$TARGET_DIR/bin/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/reader.mjs" "$TARGET_DIR/bin/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/rubric.mjs" "$TARGET_DIR/bin/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/rules.mjs" "$TARGET_DIR/bin/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/schema.mjs" "$TARGET_DIR/bin/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/trace/verify.mjs" "$TARGET_DIR/bin/lib/trace/"
cp "$PLUGIN_DIR/bin/lib/registry/normalize.mjs" "$TARGET_DIR/bin/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/registry/resolve-path.mjs" "$TARGET_DIR/bin/lib/registry/"
cp "$PLUGIN_DIR/bin/lib/trace/scorecard.mjs" "$TARGET_DIR/bin/lib/trace/"

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
echo "Installed jelou workflows/templates/references and updater"

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
