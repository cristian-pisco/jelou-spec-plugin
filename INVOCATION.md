# Invocation Reference

`jelou-spec-plugin` ships for three runtimes. Skill content is shared; only the invocation prefix differs.

## Claude Code

Skills are invoked with the plugin namespace prefix `jlu:`.

| Skill                  | Invocation                       |
|------------------------|----------------------------------|
| `new-task`             | `/jlu:new-task [desc] [clickup-url\|id] [--no-autochain]` |
| `execute-task`         | `/jlu:execute-task [slug] [clickup-url\|id] [--no-autochain]` |
| `map-codebase`         | `/jlu:map-codebase [service-id]` |
| `refine-task`          | `/jlu:refine-task [change-desc] [clickup-url\|id] [--no-autochain]` |
| `extend-phase`         | `/jlu:extend-phase`              |
| `ship`                 | `/jlu:ship`                      |
| `resolve-pr`           | `/jlu:resolve-pr [pr-url\|pr-number] [--autonomous]` |
| `report-task`          | `/jlu:report-task`               |
| `load-context`         | `/jlu:load-context`              |
| `close-task`           | `/jlu:close-task`                |
| `rollback-phase`       | `/jlu:rollback-phase`            |
| `task-clickup`         | `/jlu:task-clickup`              |
| `daily-slack`          | `/jlu:daily-slack`               |
| `architecture-review`  | `/jlu:architecture-review`       |
| `ubiquitous-language`  | `/jlu:ubiquitous-language`       |
| `goal`                 | `/jlu:goal [goal matrix]`        |

The `jlu:` prefix derives from `.claude-plugin/plugin.json` (`name: "jlu"`). Skill names are taken from each `skills/*/SKILL.md` `name:` field. Claude Code auto-discovers all skills in `skills/` at plugin install time.

## OpenCode

Commands are invoked with a hyphen-prefixed name (`jlu-`).

OpenCode normalization rules:
- `/jlu-<name>` and bare `jlu-<name>` are equivalent.
- If a `jlu-*` command exists, command execution takes precedence over similarly named skills.

| Skill                  | Invocation                       |
|------------------------|----------------------------------|
| `new-task`             | `/jlu-new-task [desc] [clickup-url\|id] [--no-autochain]` |
| `execute-task`         | `/jlu-execute-task [slug] [clickup-url\|id] [--no-autochain]` |
| `map-codebase`         | `/jlu-map-codebase [service-id]` |
| `refine-task`          | `/jlu-refine-task [change-desc] [clickup-url\|id] [--no-autochain]` |
| `extend-phase`         | `/jlu-extend-phase`              |
| `ship`                 | `/jlu-ship`                      |
| `resolve-pr`           | `/jlu-resolve-pr [pr-url\|pr-number] [--autonomous]` |
| `report-task`          | `/jlu-report-task`               |
| `load-context`         | `/jlu-load-context`              |
| `close-task`           | `/jlu-close-task`                |
| `rollback-phase`       | `/jlu-rollback-phase`            |
| `task-clickup`         | `/jlu-task-clickup`              |
| `daily-slack`          | `/jlu-daily-slack`               |
| `architecture-review`  | `/jlu-architecture-review`       |
| `ubiquitous-language`  | `/jlu-ubiquitous-language`       |
| `goal`                 | `/jlu-goal [goal matrix]`        |

`/jlu-create-pr` is a deprecated alias for `/jlu-ship`, and `/jlu-production-like` is a deprecated alias for `/jlu-goal`; each prints a warning and delegates immediately. Before opening PRs, `/jlu-ship` validates that each service installs deps cleanly and builds — in-container for docker-compose services.

OpenCode commands live in `.opencode/commands/jlu-<skill>.md` and resolve workflow files global-first from `~/.config/opencode/jelou/` before project-local fallbacks. Most commands dispatch `jelou/workflows/<skill>.md`; OpenCode-specific overrides may live under `jelou/workflows-opencode/`.

## Codex CLI

Exposed as native Codex **skills** (`.codex/skills/jlu-<skill>/SKILL.md`). Invoke a skill explicitly with `$jlu-<skill>`, or let Codex trigger it implicitly when your request matches the skill's `description`.

| Skill                  | Invocation                       |
|------------------------|----------------------------------|
| `new-task`             | `$jlu-new-task [desc] [clickup-url\|id] [--no-autochain]` |
| `execute-task`         | `$jlu-execute-task [slug] [clickup-url\|id] [--no-autochain]` |
| `map-codebase`         | `$jlu-map-codebase [service-id]` |
| `ship`                 | `$jlu-ship`                      |
| `resolve-pr`           | `$jlu-resolve-pr [pr-url\|pr-number] [--autonomous]` |
| … (all skills)         | `$jlu-<skill>`                   |

Codex skills live in `.codex/skills/jlu-<skill>/SKILL.md` and resolve workflow files global-first from `$CODEX_HOME/jelou/workflows/` (default `~/.codex/jelou/`) before project-local fallbacks. Codex subagents are TOML files in `.codex/agents/<agent>.toml`. Both are **generated** from canonical sources by `bin/sync-codex.mjs` — do not hand-edit. Install globally with `bin/install-codex.sh` (skills → `~/.agents/skills/`), or install the whole plugin via `codex plugin marketplace add cristian-pisco/jelou-spec-plugin` then `codex plugin add jlu@jelou-spec-plugin`. **Pick one route** — both register the same 35 skills, so running both surfaces every `jlu-*` skill twice. They are not equivalent: the marketplace route installs the skills only, with no subagents (`task` steps degrade to inline execution), no PreToolUse guards, and no Context7 MCP. `bin/install-codex.sh` is the complete install and the recommended one; treat the marketplace route as skills-only until those gaps close. The Codex runtime contract (no structured `question`, `agents.max_depth = 1`) lives in `jelou/references/codex-runtime.md`.

## Agent dispatch

All three runtimes load the same agent definitions from disk:

- **Canonical source:** `agents/*.md` — rich frontmatter with `name`, `description`, `tools`, `model`. Edit only here.
- **OpenCode mirror:** `.opencode/agents/*.md` — auto-regenerated by `bin/sync-agents.mjs`. Do not hand-edit.

To update an agent, edit `agents/<agent>.md` and run `node bin/sync-agents.mjs`. CI fails if `node bin/sync-agents.mjs --check` reports drift.

## Why different prefixes?

Claude Code namespaces plugin commands as `<plugin-name>:<skill-name>` (`jlu:`). OpenCode and Codex both use flat, hyphen-prefixed command names (`jlu-`). Rather than diverge skill names per runtime, the plugin keeps skill names canonical and ships thin per-runtime command shells (Claude Code skills, OpenCode commands, Codex skills) that all delegate into the shared `jelou/workflows/*.md` files.

## Where things live

| Concern               | Location                              |
|-----------------------|---------------------------------------|
| Claude Code skills    | `skills/<skill>/SKILL.md`             |
| OpenCode commands     | `.opencode/commands/jlu-<skill>.md`   |
| Codex skills (mirror) | `.codex/skills/jlu-<skill>/SKILL.md`  |
| Workflow content      | `jelou/workflows/<skill>.md`          |
| Agent prompts (src)   | `agents/<agent>.md`                   |
| Agent prompts (OpenCode mirror)| `.opencode/agents/<agent>.md`|
| Agent prompts (Codex mirror)| `.codex/agents/<agent>.toml`    |
| Shared references     | `jelou/references/<topic>.md`         |
| Templates             | `jelou/templates/<artifact>.md`       |
| Plugin manifest (CC)  | `.claude-plugin/plugin.json`          |
| Plugin manifest (Codex)| `.codex-plugin/plugin.json`          |
| Marketplace manifest  | `.claude-plugin/marketplace.json`     |
