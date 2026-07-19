---
description: Automatically fix a failing service in the JLU dev environment (bounded, opt-in loop)
agent: build
---
Resolve workflow path in this order:
1. `<HOME>/.config/opencode/jelou/workflows/autofix.md` (global install preferred; resolve `<HOME>` to an absolute path first)
2. `jelou/workflows/autofix.md` (project-local fallback)

Resolution rules:
- Select the first existing path only.
- Do not read or execute lower-priority paths when a higher-priority path exists.
- If neither path exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Use `task` for subagent dispatches (used to invoke jlu-dev-diagnoser and jlu-implementer).
Always reference commands with the `jlu-` prefix.
