# Lifecycle States Reference

> This document defines the state machine for task lifecycle management in the Jelou Spec Plugin. All state is file-based (Decision #32) — persisted in TASKS.md and phase files.

## Main Task States

```
draft -> refining -> planned -> implementing -> validating -> ready_to_publish -> done -> closed
```

| State | Description | Entry Condition |
|-------|-------------|-----------------|
| `draft` | Task created, SPEC.md is a minimal seed | `/jlu:new-task` executed |
| `refining` | Spec interview in progress | `/jlu:refine-spec` started |
| `planned` | Spec approved, PROPOSAL.md generated, phases defined | Spec approved by user |
| `implementing` | Code agents executing phases via TDD | User approves `planned -> implementing` |
| `validating` | All phases complete, final QA validation running | All phase implementations done |
| `ready_to_publish` | All tests green, artifacts ready, PR prepared | QA validation passed |
| `done` | Manual closure approved, ClickUp set to PENDING TO PRODUCTION | User approves closure |
| `closed` | PR merged, ClickUp CLOSED, task archived | `/jlu:close-task` with merged PR |

## State Transition Rules

### Normal Flow

| From | To | Trigger | Gate |
|------|----|---------|------|
| `draft` | `refining` | `/jlu:refine-spec` invoked | None |
| `refining` | `planned` | Spec interview complete | **Human approval** of final SPEC.md |
| `planned` | `implementing` | `/jlu:execute-task` invoked | **Human approval** to begin execution |
| `implementing` | `validating` | All phases in current scope complete | Automatic (orchestrator detects completion) |
| `validating` | `ready_to_publish` | All tests green + artifacts complete | QA agent signs off |
| `ready_to_publish` | `done` | User confirms readiness | **Manual closure approval** |
| `done` | `closed` | `/jlu:close-task` executed | PR in `merged` state |

### Re-entry via /jlu:extend-phase

| From | To | Trigger | Gate |
|------|----|---------|------|
| `implementing` | `refining` | `/jlu:extend-phase` with major impact | Orchestrator assessment |
| `implementing` | `planned` | `/jlu:extend-phase` with minor impact | Orchestrator assessment |
| `validating` | `planned` | `/jlu:extend-phase` | Orchestrator assessment |

When `/jlu:extend-phase` runs (Decision #24), existing code is preserved as baseline (Decision #15). New or modified phases build on top.

## Exceptional States

| State | Description | Entry | Exit |
|-------|-------------|-------|------|
| `blocked` | Agent cannot continue without external resolution | Agent flags a blocking issue | Blocker resolved, returns to last operational state |
| `awaiting_user` | Approval or missing data needed from user | Orchestrator needs user input | User provides input, returns to last operational state |
| `cancelled` | Task abandoned | User explicitly cancels | Terminal state (no exit) |

### Rules for Exceptional States

- `blocked` and `awaiting_user` are overlays on the operational state. When the block is resolved, the task returns to the state it was in before the block.
- Retries are recorded in the Timeline section of TASKS.md, not as separate states.
- An agent failure (Decision #1) triggers a fresh agent spawn with the failure summary, not a state transition.

## Per-Service Sub-States

Each service within a multi-service task tracks its own lightweight sub-state:

| Sub-State | Description |
|-----------|-------------|
| `planned` | Service scope defined, phases ready |
| `implementing` | Code agents actively working on this service |
| `validating` | Service-level tests running |
| `done` | All phases complete, tests green for this service |

### Sub-State Rules

- The main task state is the aggregate of all service sub-states.
- The main task can only transition to `validating` when **all** services reach `done` (or are explicitly excluded).
- Services execute in dependency order as defined in PROPOSAL.md (Decision #9): parallel where independent, sequential where one depends on another.

## Session Recovery (Decision #35)

If a session ends mid-execution, TASKS.md preserves the exact state. When `/jlu:execute-task` is re-invoked, the orchestrator presents the current state and offers:

1. **Resume** — Continue from the next incomplete phase.
2. **Re-validate** — Re-run tests on completed phases, then resume.
3. **Start over** — Reset all phases to pending and begin from scratch.

## Execution Modes (Decision #29)

| Mode | Behavior |
|------|----------|
| **Autonomous** (default) | Phases run automatically after `planned -> implementing` approval. User interrupted only on failures, blocks, or approval-required transitions. |
| **Step-by-step** | Orchestrator pauses before each phase and waits for user approval to continue. |

## Approval UX (Decision #25)

At every approval gate, the orchestrator presents:

- A short executive summary of what is being approved.
- Clear references to the full artifacts the user should review.
- One-click approve to proceed.
