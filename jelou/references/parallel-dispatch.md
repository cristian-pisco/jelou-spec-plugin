# Parallel Dispatch

> Reference for the orchestrator when a phase or coordination step touches multiple services. Adapted from `superpowers:dispatching-parallel-agents` for jelou's multi-service execution model.

## Core Principle

When a phase affects N services with no shared state and no sequential dependency between their work, dispatch N agents in parallel — one per service, in a **single orchestrator message** — instead of N sequential dispatches.

## When to Parallel-Dispatch

Use parallel dispatch when:

- A phase touches multiple services
- The work in each service is independent — no shared file edits, no shared state, no contract one service must define before another
- The agents being dispatched share a role (e.g., test-writer × N services, implementer × N services)
- The orchestrator can fan out at this step (no per-service decision in between)

Do NOT parallel-dispatch when:

- Services share state being modified (Service A writes a contract Service B reads in the same phase)
- The phase has explicit sequential dependencies (Service A's API must exist before Service B's consumer is wired up)
- The agents would compete for the same resource (overlapping file paths, same database)

## The Pattern

### 1. Group by independent domain

For a phase with services S1, S2, S3 and the same agent role (e.g., test-writer), each service is its own independent domain — fixture state and source paths are isolated per service.

### 2. Construct one focused prompt per service

Each agent gets:

- **Specific scope**: ONE service ID, ONE service source path (`SERVICE_SOURCE_PATH` from worktree resolution).
- **Specific input**: the phase requirements relevant to that service, the service's `CONVENTIONS.md`, and the service-specific Docker context.
- **Constraints**: do not write files outside the service worktree.
- **Expected report shape**: the standard subagent contract output — see `jelou/references/subagent-contract.md`.

### 3. Dispatch in a single message

The orchestrator emits a single tool-use turn with multiple `Agent` (Claude Code) or `task` (OpenCode) calls. They run concurrently.

```
Agent("test-writer for service-auth, phase 02 — <prompt>")
Agent("test-writer for service-orders, phase 02 — <prompt>")
Agent("test-writer for service-gateway, phase 02 — <prompt>")
```

Three agents, one message, parallel execution.

### 4. Review and integrate

After all agents return:

- Check each report's `status` field.
- Verify no agent wrote outside its service worktree (FAIL the batch if any did).
- Verify no two agents touched the same file (compare `artifacts` arrays).
- Aggregate the reports into the per-phase TASKS.md update.

## Where This Applies in jelou

Per-phase fan-out points in `jelou/workflows/execute-task.md`:

| Step | Agent | Fan-out condition |
|------|-------|-------------------|
| 7d (TDD Red) | `jlu-test-writer` | N affected services for this phase |
| 7e (TDD Green) | `jlu-implementer` | N affected services for this phase |
| 7h (Per-Phase QA) | `jlu-qa-agent` | N affected services for this phase |
| 7k (Build Validation) | `jlu-build-validator` | N Docker services for this phase |

Per-task fan-out points (already parallel by precedent at Step 4f / line 159 of execute-task.md):

- `map-codebase`: structural and operational analyzers per service
- `new-task`: per-service worktree setup as a background subtask group
- Step 4f (proposal): `jlu-proposal-agent` per service

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Too broad scope ("write tests for the whole system") | One service per agent. ONE phase per agent. |
| No constraints on write scope | Specify the worktree boundary explicitly. The agent should refuse writes outside. |
| Vague output expectation | Specify the subagent contract output shape so reports are aggregable. |
| Sequential dispatch when parallel is possible | Group services per phase. Single orchestrator message with one Agent call per service. |
| Dispatching when work is dependent | If Service B reads a contract Service A defines this phase, run sequentially or split into two phases. |

## Conflict Detection

After parallel dispatch returns:

- Compare each report's `artifacts` array. If two reports list overlapping file paths, the batch FAILs — the agents stepped on each other.
- If any report's `status` is `blocked` or `failed`, treat the whole batch as needing escalation; do not proceed to the next phase step on the unaffected services.
- Run cross-service validation (per-phase QA "Cross-Service Contracts" check) AFTER the batch returns and conflicts are cleared.

## When in Doubt

Default to parallel when the phase clearly fans out to independent services. The cost of an extra sequential dispatch is one wasted minute per service per phase; the cost of a missed parallelization across a 4-service, 8-phase task is hours.

If you cannot articulate why two services' work in this phase is dependent, they probably are not dependent. Dispatch in parallel.
