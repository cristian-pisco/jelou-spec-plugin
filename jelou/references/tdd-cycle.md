# TDD Cycle Reference

> This document defines the strict Test-Driven Development cycle enforced by the Jelou Spec Plugin. TDD is not optional — it is a core engineering principle (Precedence #4) and is enforced by the orchestrator at every implementation phase.
>
> For the *philosophical* foundations every agent in the TDD pipeline must apply (behavior-not-implementation, vertical slicing, deep modules, interface design, mocking at boundaries, refactor candidates, anti-patterns), see `tdd-principles.md`. This file describes the *operational* protocol only.

## The Red-Green-Refactor Cycle

Every unit of implementation follows the same three-step cycle:

### 1. Red — Write a Failing Test

The **authoring agent** (`jlu-tdd-cycle`) writes a failing test first, before its implementation exists.

- Tests are derived from the phase requirements (which trace back to SPEC.md).
- Tests must fail when first run. A test that passes without implementation is either testing nothing or the feature already exists.
- Tests MUST cover, per requirement that validates or types input (request body, typed query parameters, or a cross-field reference) — this is the **case-matrix floor** enforced by `jlu-test-writer` and `jlu-tdd-cycle`, derived from the DTO/type surface rather than from whether SPEC.md mentions the case:
  - **Success paths**: The expected behavior when inputs are valid.
  - **Error / rejection paths**: one rejecting payload per validation decorator or type constraint (string-where-`@IsNumber`, GUID-where-numeric-id, empty-where-required-collection, missing-required, out-of-range), each asserting the 4xx and error shape.
  - **Realistic / cross-field paths**: at least one payload that populates every cross-field reference the requirement resolves; collections exercised non-empty, never the minimal stub.
  - **Edge cases**: Boundary conditions, empty inputs, concurrent access, maximum values.
  Requirements with no validated/typed input and no cross-field reference are exempt.
- Tests are documentation. They should read as behavioral specifications, not implementation details.

The orchestrator confirms the tests fail (red) before proceeding.

### 2. Green — Write the Minimum Code to Pass

The same agent then writes the minimum code necessary to make it pass.

- "Minimum" means exactly what it says: no extra features, no premature abstractions, no "while I'm here" additions.
- The agent works within the constraints defined by the phase requirements and the existing codebase conventions.
- If all tests pass, the phase moves to refactor.
- If tests fail after implementation, the agent iterates until green.

### 3. Refactor — Improve Without Breaking Green

Refactoring is not part of the per-phase loop. After ALL phases are complete,
`jlu-refactor-agent` runs once per affected service (Step 8a.3, skipped when every
phase was trivial or no candidates were reported) and applies surgical refactors
against the union of the task's `Refactor Candidates`, guided by `tdd-principles.md` §7:

- Eliminate duplication.
- Deepen shallow modules (small interface, deep implementation).
- Improve naming and readability.
- Extract functions or modules where clarity improves.
- Address what the new code revealed about pre-existing code.

**Critical rule**: Tests must remain green after every refactor step. If a refactor breaks a test, it is rolled back.

## The Authoring Agent (Decision #4)

Every TDD phase is authored by a single agent, `jlu-tdd-cycle`, which drives the
RED→GREEN loop per requirement in one session. Multi-service phases fan out one
`jlu-tdd-cycle` per service (see `parallel-dispatch.md`).

| Agent | Role | Model Tier |
|-------|------|------------|
| **tdd-cycle** | Per-FR loop: one behavior slice at a time (rejection cases batched per surface) → RED → GREEN → next FR | Sonnet |
| **refactor-agent** | Applies aggregated refactor candidates once per service (Step 8a.3) | Sonnet |

`jlu-test-writer` and `jlu-implementer` are not part of per-phase authoring. They
retain other roles: `jlu-test-writer` authors Tier 2 integration tests (Step 8a) and
backend E2E suites (Step 8f); `jlu-implementer` applies fixes (QA-fix in 7h,
affected-test fix in 8b) and Tier 2 wiring. There is no separate test-dispute
mechanism — the authoring agent owns both test and implementation, and the
Self-Correction rule (documented test rewrites with a spec quote, audited by QA)
is the safeguard. When a test is correct but the agent cannot make it green after
multiple attempts, that is not a self-correction case — apply
`jelou/references/systematic-debugging.md` to trace the root cause before further
fixes; the three-strike rule there governs when to escalate as `status: blocked`
instead of attempting another fix.

## Coverage Requirements

### Per Service

| Level | Scope | When Required |
|-------|-------|---------------|
| **Unit tests** | Individual functions, methods, classes | Always |
| **Integration tests** | Interactions between modules within the service | Always |
| **E2E tests** | Full user-facing flows | When applicable (services with user-facing APIs or UIs) |

### What Must Be Tested

- **Success paths**: Happy path for each requirement.
- **Error / rejection paths**: All expected failure modes — and, for input-validating requirements, one rejecting payload per validation decorator/type constraint (derived from the DTO surface, not from what SPEC.md mentions), each asserting the 4xx.
- **Realistic / cross-field paths**: At least one payload populating every cross-field reference the requirement resolves; collections exercised non-empty, never only the empty stub.
- **Edge cases**: Boundary values, empty collections, null inputs, concurrent mutations.

### Case-Matrix Derivation Procedure (canonical)

Authoring agents (`jlu-tdd-cycle` for phases; `jlu-test-writer` for Tier 2 / E2E)
derive each requirement's coverage from the INPUT CONTRACT, not the happy path:

a. Locate the input surface (controller method + DTO/`class-validator` decorators,
   Zod/Joi schema, validation pipe, typed query params). A requirement with no input
   and no cross-field reference is **exempt** — name the exemption in the report.
b. Enumerate every validation rule on that surface — this list IS the rejection list.
   A field typed `number`/`string`/`uuid` with no visible decorator still carries a
   type constraint; count it.
c. Assemble the matrix: one **success** slice; one rejection case per
   decorator/type constraint (violating value → documented 4xx + error shape); one
   **realistic** slice populating every cross-field reference (collections non-empty,
   never the empty stub); **boundary** slices where they apply.
d. Work the matrix vertically — one behavior slice (success / realistic) at a time.
   Rejection cases are batched: all rejection cases that target the same
   DTO/validation surface are authored and wired as ONE batched slice — write every
   rejecting test for that surface, run them once (RED), wire every missing
   decorator/guard/pipe, run them once (GREEN). Boundary cases join the same
   surface's batch: boundary-reject cases are rejections, and boundary-accept cases
   (the exact-limit value that must pass) ride the batch's GREEN run — they may
   already be green on the batch's RED run once the success slice exists, which is
   fine; the RED gate applies to the rejecting tests. Coverage is unchanged: the
   batch still contains one rejection case per decorator/type constraint plus the
   surface's boundary cases; only the cycle granularity changes. Never interleave
   two surfaces in one batch.

### Multi-Service Closure (Section 14.3)

A task is not considered complete until:

- All required test suites pass (green) across all affected services.
- Cross-service contracts and integrations are verified.
- All spec artifacts are complete and consistent.

## Test Tiers

The TDD cycle uses a tiered testing strategy to keep the feedback loop fast while maintaining full coverage at the end. **No tier uses Docker.** Tests, build, lint, and format always run on the host runtime directly.

### Tier 1: TDD Feedback Loop
- Unit tests and mock-based integration tests.
- No external infrastructure (no databases, no running services, no containers).
- Mocks at system boundaries only — see `tdd-principles.md` §6.
- Must run in under 5 seconds per phase.
- Used during Red-Green (Step 7d) and the task-level refactor pass (Step 8a.3).
- Run only the phase's test files, not the full suite.
- Every run carries the worker cap — see `subagent-base.md` "Test Execution Resource Limits".

### Tier 2: Final Validation
- Integration tests against **host-resident** infrastructure only (e.g., a real Postgres the developer started via `/jlu-start-dev`).
- No Testcontainers, no `dockerode`, no `docker compose` shell-outs in any tier — these are banned in all TDD tiers (see `jlu-qa-agent.md` Test Tier Compliance). The only exception is the E2E path (`test/e2e/**`, `*.e2e-spec.ts`), which the TDD pipeline never runs — only `/jlu-goal` does.
- Written after all phases are complete, for requirements that couldn't be meaningfully tested with mocks.
- If a required dependency is not running on the host, the test is reported skipped with a clear reason — agents never start anything.
- Run exactly ONCE, at Step 8a (Final Validation), as targeted test files with the worker cap — never as a bare full-suite run.
- The full suite never runs inside the task workflow: Step 8b runs affected tests only (`--maxWorkers=2`), and the full suite belongs to the on-demand `/jlu-test-suite` skill (workers=1) and CI on push.

### Why no Docker in any tier
- Memory and CPU pressure on the host from accumulating containers across iterations.
- Slow feedback loops (minutes instead of seconds per cycle).
- Zombie containers from interrupted or retried test runs.
- Dev-container lifecycle is independently owned by `/jlu-start-dev`; conflating it with the TDD loop pulls in failures from the dev runtime that have nothing to do with the code under test.

The TDD cycle's value comes from speed. Integration tests' value comes from fidelity. Separating them by tier — and keeping both on the host runtime — serves both purposes without compromise.

### Test Count Per Task

| Step | What runs | Times |
|------|-----------|-------|
| 7d TDD Cycle | Phase test files only (Tier 1) | per slice |
| 7h QA | Nothing (static analysis) | 0 |
| Step 8a Tier 2 | Deferred Tier 2 test files only | ≤1 total |
| 8a.3 Refactor | Union of task test files (Tier 1) | 0-1 per service |
| Step 8a.5 Build | Nothing (compile only) | 1 per service |
| Step 8b Regression | Affected tests only (`--maxWorkers=2`) | 1 total |

## QA Agent Validation (Decision #13)

The QA agent operates at two levels:

1. **Continuous (per-phase)**: After each phase completes, a lightweight static review verifies convention compliance, requirement coverage, and test tier correctness. No test execution.
2. **Final (task-level)**: After all phases are done, a full validation pass covers:
   - Coverage analysis across the entire task scope.
   - Edge case review against the spec.
   - Cross-service contract verification.
   - Consistency between artifacts (SPEC.md requirements vs. test coverage vs. implementation).
