---
description: Stateful research/decision command — one engine per call, persisted as a resumable note
agent: build
---
Resolve `<install-root>` first: walk up from THIS command file to the nearest ancestor directory
that contains a `jelou/` directory. The command lives at `<install-root>/.opencode/commands/` on a
project install and at `<install-root>/commands/` on a global one, so the depth is not fixed. Never
assume a literal path: `$OPENCODE_HOME` moves `<install-root>` anywhere.

Resolve workflow path in this order:
1. `<install-root>/jelou/workflows/investigate.md` (install preferred)
2. `jelou/workflows/investigate.md` (project-local fallback)

Resolution rules:
- Select the first existing path only.
- Do not read or execute lower-priority paths when a higher-priority path exists.
- If neither path exists, stop and report both checked paths.

Read exactly one resolved workflow file and execute it exactly.

Runtime contract (OpenCode):
- `perplexity` engine → use OpenCode's native web research tool.
- `fusion` engine → run `bin/investigate.mjs fusion` (needs `OPENROUTER_API_KEY`).
- No research tool and no key → persist the round as unresolved; never invent a fact.

Command arguments: $ARGUMENTS
Current directory is the project working directory.

Use `question` for user prompts.
Always reference commands with the `jlu-` prefix.
