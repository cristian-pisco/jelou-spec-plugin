---
description: Convene a multi-model jury on an architecture idea
agent: build
---
Resolve `<install-root>` first: walk up from THIS command file to the nearest ancestor directory
that contains a `jelou/` directory. The command lives at `<install-root>/.opencode/commands/` on a
project install and at `<install-root>/commands/` on a global one, so the depth is not fixed. Never
assume a literal path: `$OPENCODE_HOME` moves `<install-root>` anywhere.

Resolve workflow path in this order:
1. `<install-root>/jelou/workflows/council.md` (install preferred)
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
