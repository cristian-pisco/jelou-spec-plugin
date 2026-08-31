---
name: update
description: "Use to update the Jelou Spec Plugin to the latest version from any runtime. On Claude Code it drives the plugin CLI directly (no manual /plugin update); on Codex and OpenCode it pulls the shared git cache and reinstalls. Triggers: \"update the plugin\", \"update jlu\", \"upgrade jelou plugin\", \"actualizar el plugin\", \"actualiza jlu\", \"get the latest version of the plugin\""
argument-hint: "[--ref <ref>]"
allowed-tools:
  - Read
  - Bash
---

You are the orchestrator for the `/jlu-update` command.

## Phase 1 — Resolve plugin root

Resolve the plugin root. Try in order:
1. Go up 2 levels from this skill's directory (plugin install at `<plugin-root>/skills/update/SKILL.md`).
2. `~/.claude/jelou/` (manual installation) — in this case the plugin scripts live under `~/.claude/`.

If neither resolves, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

## Phase 2 — Execute Workflow

Read `<plugin-root>/jelou/workflows/update.md` and execute it yourself in this session.
Do NOT spawn a sub-agent.

This is the Claude Code runtime, so your host is `claude`. The argument is `{argument}`.
The plugin root is the path resolved above. The current working directory is `{cwd}`.
