---
description: Drive the current branch's PR(s) to green — review comments, merge conflicts, failing CI jobs, and SonarQube issues (interactive or --autonomous)
agent: build
---
Resolve workflow path in this order:
1. `<HOME>/.config/opencode/jelou/workflows/resolve-pr.md` (global install preferred; resolve `<HOME>` to an absolute path first)
2. `jelou/workflows/resolve-pr.md` (project-local fallback)

Resolution rules:
- Select the first existing path only.
- Do not read or execute lower-priority paths when a higher-priority path exists.
- If neither path exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Use `task` for subagent dispatches.
Always reference commands with the `jlu-` prefix.

In `--autonomous` mode never prompt: every ask-path resolves to skip, rerun, or escalate — never apply.
