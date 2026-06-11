---
description: Convene a multi-model jury on an architecture idea
agent: build
---
Resolve workflow path in this order:
1. `<HOME>/.config/opencode/jelou/workflows/council.md` (global install preferred; resolve `<HOME>` to an absolute path first)
2. `jelou/workflows/council.md` (project-local fallback)

Resolution rules:
- Select the first existing path only.
- Do not read or execute lower-priority paths when a higher-priority path exists.
- If neither path exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts (OpenCode equivalent of question).
For the workflow's uncertainty research (§4.3), use OpenCode's web search (or Perplexity if connected); if no web tool is available, declare the uncertainty unresolved — never assume.
On consensus the only onward command is `/jlu-new-task` — never route to another plugin.
Execute the workflow inline — you are the arbiter; the design forbids delegating the synthesis to a sub-agent.
Always reference commands with the `jlu-` prefix (never `jlu:`).
