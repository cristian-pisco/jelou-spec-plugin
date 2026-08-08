# Parallel Dispatch

> Reference for the orchestrator when a phase or coordination step touches multiple services. Adapted from `superpowers:dispatching-parallel-agents` for jelou's multi-service execution model.

## Core Principle

When a phase affects N services with no shared state and no sequential dependency between their work, dispatch N agents in parallel — one per service, in a **single orchestrator message** — instead of N sequential dispatches.

## Resource Safety Gate

Parallel fan-out is optional, not mandatory. Use it only when the workflow-level throttle allows it:

- The resolved numeric cap is `> 1` for per-phase agent fan-out AND for per-task fan-out (proposal-agent multi-service, codebase analyzers). Inside `execute-task` that cap is `TASK_FANOUT_CAP` / the wave plan's `chosen_cap`; in `map-codebase` it is `JLU_PHASE_PARALLELISM` directly.

Inside `execute-task`, the default is planner-resolved `auto`: `bin/plan-phase-waves.mjs` computes the numeric cap (`chosen_cap` in the wave-plan JSON; `--emit-cap-only` for the orchestrator-side `TASK_FANOUT_CAP`), and `JLU_PHASE_PARALLELISM` acts as a reduce-only manual ceiling over it. Sequential is still the outcome when the resolved cap is 1 (W=1 — the common mono-service case). Outside `execute-task` (`map-codebase`), the old semantics stand: direct cap from `JLU_PHASE_PARALLELISM`, default `1` (sequential).

When the resolved cap is `> 1`, every concurrently dispatched agent must tighten its test runs to ONE worker (`--runInBand`, `maxThreads=1`, `-n 1`, `-p 1`): the per-agent cap of 2 workers in `subagent-base.md` "Test Execution Resource Limits" assumes a single agent running tests at a time. State this in each dispatched prompt. The same invariant governs the orchestrator's own Step 8b affected-tests commands (1 worker when `TASK_FANOUT_CAP > 1`).

### Deprecated throttles

| Env var | Status | Why |
|---------|--------|-----|
| `JLU_FINAL_TEST_PARALLELISM` | Deprecated since the full-suite extraction to `/jlu-test-suite`. The orchestrator no longer fans out the full suite in Step 8b (it now runs affected tests only, sequentially per service under `PHASE_PARALLELISM`). The variable is silently ignored. |
| `JLU_TEST_MAX_WORKERS` | Deprecated. Step 8b now uses a fixed cap of 2 workers for affected-tests; `/jlu-test-suite` uses a fixed cap of 1 worker. Neither honors this env var. |

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

Two distinct fan-out axes apply in `execute-task.md`:

1. **Wave-level fan-out (H7)** — when `PROPOSAL.md` declares `Execution Strategy: per-service-parallel`, Step 7.0 builds waves where each wave contains one phase per service. All phases in a wave dispatch concurrently in a single orchestrator message, capped by `PHASE_PARALLELISM`. See `bin/plan-phase-waves.mjs` for the deterministic plan.
2. **Per-phase fan-out** — within a single phase that affects multiple services (rarer with H7 since most multi-service phases get split into per-service phases by the proposal-agent), 7d dispatches one agent per service. QA is final-only: a single `jlu-spec-reviewer` dispatch at Step 8c, never fanned out per phase.

Per-phase fan-out points:

| Step | Agent | Fan-out condition |
|------|-------|-------------------|
| 7d (TDD Cycle) | `jlu-tdd-cycle` | N affected services for this phase |
| 8b (Affected Tests) | (no agent — orchestrator `Bash`) | N affected services for the task |

Per-task fan-out points (also gated by `PHASE_PARALLELISM`; sequential by default):

| Workflow | Step | Agents fanned out |
|----------|------|-------------------|
| `map-codebase` | Batch B4 | `jlu-codebase-mapper` per discovered service |
| `map-codebase` | Step 5 | structural + operational analyzers for a single service |
| `execute-task` | Step 4c (proposal) | `jlu-proposal-agent` per service (multi-service tasks only) |
| `execute-task` | Step 8a.5 (build) | `jlu-build-validator` per affected service with a compilable diff |
| `new-task` | Step 8 (worktree setup) | per-service git worktree creation |

These were previously dispatched in parallel by precedent. They're now gated by the resolved cap (`TASK_FANOUT_CAP` in `execute-task`, `JLU_PHASE_PARALLELISM` directly in `map-codebase`), so a developer running multiple agents under heavy local load can set `JLU_PHASE_PARALLELISM=1` — a reduce-only ceiling inside `execute-task` — and get full sequential behavior.

`map-codebase` root batch mode must remain flat: the orchestrator dispatches one
`jlu-codebase-mapper` per service, and each mapper executes the structural and
operational analysis inline. A mapper must not invoke `/jlu-map-codebase` and must
not dispatch the structural/operational analyzers itself. Shared writes such as
`registry/services.yaml` and glossary merging are serialized by the root orchestrator
after mapper workers return.

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
- Cross-service contract validation happens at the final QA gate (Step 8c "Cross-Service Contracts" check), AFTER all batches have returned and conflicts are cleared.

## When in Doubt

Inside `execute-task`, the planner resolves the default (`auto`); sequential is still the outcome when the resolved cap is 1 (W=1). Outside `execute-task`, default to sequential unless parallelism was explicitly enabled. Predictable resource usage beats theoretical speedups that can crash the machine.

If you enable parallelism, keep it conservative and validate there is no shared-state contention before fan-out.
