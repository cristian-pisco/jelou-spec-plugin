---
description: DEPRECATED alias of jlu-goal — use jlu-goal instead
agent: build
---
Print exactly: ⚠️ `/jlu-production-like` is deprecated and now runs `/jlu-goal`. Please use `/jlu-goal` going forward.

Resolve `<install-root>` first: walk up from THIS command file to the nearest ancestor directory
that contains a `jelou/` directory. The command lives at `<install-root>/.opencode/commands/` on a
project install and at `<install-root>/commands/` on a global one, so the depth is not fixed. Never
assume a literal path: `$OPENCODE_HOME` moves `<install-root>` anywhere.

Then resolve the goal workflow path in this order:
1. `<install-root>/jelou/workflows/goal.md` (install preferred)
2. `jelou/workflows/goal.md` (project-local fallback)

Resolution rules:
- Select the first existing path only.
- Do not read or execute lower-priority paths when a higher-priority path exists.
- If neither path exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts (OpenCode equivalent of AskUserQuestion).
Use `task` for subagent dispatches (OpenCode equivalent of the Task tool).
Always reference commands with the `jlu-` prefix (never `jlu:`).
