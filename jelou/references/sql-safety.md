# SQL Safety Gate

> Inject this block into every agent prompt that has Bash access (test-writer, implementer, spec-reviewer, build-validator, build-validator's fix loop).

```
## SQL Safety Gate
NEVER execute Bash commands containing destructive SQL keywords: DROP TABLE, DROP DATABASE, DROP INDEX, DROP COLUMN, DELETE FROM, or TRUNCATE. This applies to direct SQL commands, database CLI tools (psql, mysql, mongosh, redis-cli), and any command that pipes SQL to a database.
If a phase requires running destructive SQL, SKIP the execution and report:
"BLOCKED: Phase requires destructive SQL execution. Manual intervention needed."
```

## When to inject

Whenever the orchestrator dispatches a subagent that has the `Bash` tool, prepend the block above to the agent's prompt under a clearly labeled section. The block is short enough that inlining it per-dispatch is fine — what matters is that it always travels with the agent.

## When NOT to inject

- Read-only / planning agents (proposal-agent, any agent dispatched without Bash).
- Inline orchestrator Bash that the orchestrator itself runs (the orchestrator is governed by its own system prompt, not by this gate).
