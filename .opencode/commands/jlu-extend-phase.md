---
description: Extend in-progress task phase
agent: build
---
Resolve `<install-root>` first: walk up from THIS command file to the nearest ancestor directory
that contains a `jelou/` directory. The command lives at `<install-root>/.opencode/commands/` on a
project install and at `<install-root>/commands/` on a global one, so the depth is not fixed. Never
assume a literal path: `$OPENCODE_HOME` moves `<install-root>` anywhere.

Resolve workflow path in this order:
1. `<install-root>/jelou/workflows/extend-phase.md` (install preferred)
2. `jelou/workflows/extend-phase.md` (project-local fallback)

Resolution rules:
- Select the first existing path only.
- Do not read or execute lower-priority paths when a higher-priority path exists.
- If neither path exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts (OpenCode equivalent of question).
Use `task` for subagent dispatches (OpenCode equivalent of task tool).
Always reference commands with the `jlu-` prefix (never `jlu:`).
Phase 1 portability mode: skip ClickUp and Slack execution steps if encountered; report them as deferred to Phase 2.
