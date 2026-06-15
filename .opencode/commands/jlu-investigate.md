---
description: Stateful research/decision command — one engine per call, persisted as a resumable note
agent: build
---
Resolve workflow path in this order:
1. `<HOME>/.config/opencode/jelou/workflows/investigate.md` (global install preferred; resolve `<HOME>` to an absolute path first)
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
