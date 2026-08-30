---
name: dev-link
description: Use before releasing this plugin — runs the working tree as the live plugin so skills, agents and hooks can be exercised without publishing. Triggers "test the plugin locally", "probar el plugin antes del release", "dev link", "verify plugin load", "pre-release check"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

You are the pre-release verification orchestrator for this repository.

This skill is project-scoped: it exists only inside `jelou-spec-plugin` and is never
shipped to plugin consumers.

## The problem it solves

Claude Code loads `jlu` from `~/.claude/plugins/cache/jelou-spec-plugin/jlu/<version>`,
pinned to the last published commit. An unreleased edit to `skills/`, `agents/`,
`hooks/` or `bin/` is invisible to every session, so the only way to exercise a change
used to be to release it first.

`claude --plugin-dir <repo-root>` loads the tree straight from disk under the same
`jlu:` namespace and outranks the installed release for that session. No install, no
uninstall, no global state touched.

## Step 1 — Report the gap

```bash
node bin/dev-link.mjs status
```

Print the output verbatim. It shows the working-tree version and git state, the
installed release and any load errors it reports, and a per-surface diff of what a
session would see differently.

## Step 2 — Gate the tree

```bash
node bin/verify-plugin-load.mjs
```

Exit `1` means the tree would not load: report every defect and its fix, then STOP.
Do not proceed to a session that cannot load what it is meant to test.

`claude plugin validate` is not a substitute — it passed on the manifest that made
0.3.359 report `failed to load` on every install.

Add `--live` only when the user asks for it or when a skill or agent was added,
renamed or removed. It spends one model call to boot a headless session with
`--plugin-dir` and assert the skills and agents it sees are exactly the declared set.

## Step 3 — Clear the shadows

```bash
node bin/dev-link.mjs doctor
```

Findings of class `skill-shadow-*` / `agent-shadow-*` are copies the legacy fallback
installer left in `~/.claude/skills/` and `~/.claude/agents/`. They resolve under their
bare name next to the namespaced plugin surfaces, so a session can route into a frozen
workflow or an agent the plugin already retired.

Removal is destructive and touches directories outside this repo. Show
`node bin/dev-link.mjs clean-shadows` (dry run, lists every path) and ask the user with
`AskUserQuestion` before running it with `--apply`. Never pass `--apply` unprompted.

## Step 4 — Hand over the session

```bash
node bin/dev-link.mjs launch --print-command
```

Give the user the command. Launching an interactive session is theirs to run — this
session cannot become the one under test.

For a scripted check instead of an interactive session:

```bash
node bin/dev-link.mjs launch -- -p "<prompt>"
```

## Other runtimes

Only Claude Code has a live `--plugin-dir`. Codex and OpenCode read generated mirrors,
so testing the working tree there is a copy-install:

```bash
npm run sync && ./setup --host codex --host opencode
```

`doctor` fails with `mirror-drift-*` when `.codex/` or `.opencode/` lag behind
`agents/` and `skills/`.
