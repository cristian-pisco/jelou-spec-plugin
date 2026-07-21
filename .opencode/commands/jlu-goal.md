---
description: Run a goal matrix to green against the full local stack — objectives (frontend/backend/fullstack) compile to E2E suites, the stack boots once, and a bounded convergence loop (run → auto-fix → re-run) ends only when every objective is green, with mandatory video evidence for frontend/fullstack objectives
agent: build
---
Resolve workflow path in this order:
1. `<HOME>/.config/opencode/jelou/workflows/goal.md` (global install preferred; resolve `<HOME>` to an absolute path first)
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
