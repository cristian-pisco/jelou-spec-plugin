---
description: Run the current service's unit + integration tests with workers=1 and group failures by component (Controller, Service, Repository, etc.)
agent: build
---
Resolve workflow path in this order:
1. `<HOME>/.config/opencode/jelou/workflows/test-suite.md` (global install preferred; resolve `<HOME>` to an absolute path first)
2. `jelou/workflows/test-suite.md` (project-local fallback)

Resolution rules:
- Select the first existing path only.
- Do not read or execute lower-priority paths when a higher-priority path exists.
- If neither path exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: (none — the workflow rejects arguments)
Current directory is the project working directory.

Use `task` for subagent dispatches (not used in this workflow — runs inline).
Always reference commands with the `jlu-` prefix (never `jlu:`).
