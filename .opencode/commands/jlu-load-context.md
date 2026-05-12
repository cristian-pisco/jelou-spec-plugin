---
description: Load task context for Q&A
agent: build
---
Resolve workflow path in this order:
1. `<HOME>/.config/opencode/jelou/workflows-opencode/load-context.md` (global OpenCode workflow preferred; resolve `<HOME>` to an absolute path first)
2. `jelou/workflows-opencode/load-context.md` (project-local OpenCode fallback)
3. `<HOME>/.config/opencode/jelou/workflows/load-context.md` (legacy global fallback)
4. `jelou/workflows/load-context.md` (legacy project-local fallback)

Resolution rules:
- Select the first existing path only.
- Do not read or execute lower-priority paths when a higher-priority path exists.
- If none of these paths exist, stop and report every checked path.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts (OpenCode equivalent of question).
Use `task` for subagent dispatches (OpenCode equivalent of task tool).
Always reference commands with the `jlu-` prefix (never `jlu:`).
Phase 1 portability mode: skip ClickUp and Slack execution steps if encountered; report them as deferred to Phase 2.
