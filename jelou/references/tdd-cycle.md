# TDD Cycle Reference

> This document defines the strict Test-Driven Development cycle enforced by the Jelou Spec Plugin. TDD is not optional — it is a core engineering principle (Precedence #4) and is enforced by the orchestrator at every implementation phase.

## The Red-Green-Refactor Cycle

Every unit of implementation follows the same three-step cycle:

### 1. Red — Write a Failing Test

The **test-writer agent** writes tests first, before any implementation code exists.

- Tests are derived from the phase requirements (which trace back to SPEC.md).
- Tests must fail when first run. A test that passes without implementation is either testing nothing or the feature already exists.
- Tests should cover:
  - **Success paths**: The expected behavior when inputs are valid.
  - **Error paths**: The expected behavior when things go wrong (invalid input, missing resources, permission denied, network failures).
  - **Edge cases**: Boundary conditions, empty inputs, concurrent access, maximum values.
- Tests are documentation. They should read as behavioral specifications, not implementation details.

The orchestrator confirms the tests fail (red) before proceeding.

### 2. Green — Write the Minimum Code to Pass

The **implementer agent** receives the failing tests and writes the minimum code necessary to make them pass.

- "Minimum" means exactly what it says: no extra features, no premature abstractions, no "while I'm here" additions.
- The implementer works within the constraints defined by the phase requirements and the existing codebase conventions.
- If all tests pass, the phase moves to refactor.
- If tests fail after implementation, the implementer iterates until green.

### 3. Refactor — Improve Without Breaking Green

After all tests pass, the implementer (or a dedicated refactor pass) may improve the code:

- Eliminate duplication.
- Improve naming and readability.
- Simplify logic.
- Extract functions or modules where clarity improves.

**Critical rule**: Tests must remain green after every refactor step. If a refactor breaks a test, it is rolled back.

## Agent Separation (Decision #4)

The TDD cycle uses **two separate agents** per cycle:

| Agent | Role | Model Tier |
|-------|------|------------|
| **test-writer** | Writes failing tests from requirements | Sonnet |
| **implementer** | Makes tests pass with minimum code, then refactors | Sonnet |

This separation prevents the common failure mode where a single agent writes tests that match its own implementation rather than the specification.

## Test Dispute Mediation (Decision #5)

Sometimes the implementer agent discovers that a test is incorrect — it tests the wrong behavior, makes invalid assumptions, or conflicts with the spec.

When this happens:

1. The implementer flags the disputed test with a structured objection explaining why the test is wrong.
2. The orchestrator does **not** let the implementer modify or delete the test.
3. The orchestrator spawns a **fresh test-writer agent** with:
   - The original SPEC.md requirements for this phase.
   - The implementer's objection and reasoning.
   - The current test suite.
4. The fresh test agent evaluates the dispute and either:
   - **Upholds the test**: The implementer must find another way to pass it.
   - **Revises the test**: Writes a corrected version that still verifies the spec requirement.
5. The decision and reasoning are logged in the phase file under Deviations.

## Coverage Requirements

### Per Service

| Level | Scope | When Required |
|-------|-------|---------------|
| **Unit tests** | Individual functions, methods, classes | Always |
| **Integration tests** | Interactions between modules within the service | Always |
| **E2E tests** | Full user-facing flows | When applicable (services with user-facing APIs or UIs) |

### What Must Be Tested

- **Success paths**: Happy path for each requirement.
- **Error paths**: All expected failure modes (validation errors, not found, unauthorized, timeouts).
- **Edge cases**: Boundary values, empty collections, null inputs, concurrent mutations.

### Multi-Service Closure (Section 14.3)

A task is not considered complete until:

- All required test suites pass (green) across all affected services.
- Cross-service contracts and integrations are verified.
- All spec artifacts are complete and consistent.

## Test Tiers

The TDD cycle uses a tiered testing strategy to keep the feedback loop fast while maintaining full coverage at the end.

### Tier 1: TDD Feedback Loop
- Unit tests and mock-based integration tests
- No external infrastructure (no Testcontainers, no real databases, no running services)
- Must run in under 5 seconds per phase
- Used during Red-Green-Refactor (Steps 7d, 7e, 7g)
- Run only the phase's test files, not the full suite

### Tier 2: Final Validation
- Integration tests with real infrastructure (Testcontainers, real databases, message queues)
- Written after all phases are complete, for requirements that couldn't be meaningfully tested with mocks
- Run exactly ONCE during Step 8 (Final Validation)
- This is the only time the full test suite executes

### Why
Running integration tests with Testcontainers during every TDD iteration (20-36 times per task) causes:
- Memory exhaustion from accumulated Docker containers
- Slow feedback loops (minutes instead of seconds per cycle)
- Zombie containers from interrupted or retried test runs

The TDD cycle's value comes from speed. Integration tests' value comes from fidelity. Separating them by tier serves both purposes without compromise.

### Test Count Per Task

| Step | What runs | Times |
|------|-----------|-------|
| 7d Red | Phase test files only (Tier 1) | 1 per phase |
| 7e Green | Phase test files only (Tier 1) | 1-5 per phase |
| 7g Refactor | Phase test files only (Tier 1) | 0-1 per phase |
| 7h QA | Nothing (static analysis) | 0 |
| 7k Build | Nothing (compile only) | 0 |
| Step 8 Final | Full suite (Tier 1 + Tier 2) | **1 total** |

## QA Agent Validation (Decision #13)

The QA agent operates at two levels:

1. **Continuous (per-phase)**: After each phase completes, a lightweight QA check verifies that tests pass and no regressions were introduced.
2. **Final (task-level)**: After all phases are done, a full validation pass covers:
   - Coverage analysis across the entire task scope.
   - Edge case review against the spec.
   - Cross-service contract verification.
   - Consistency between artifacts (SPEC.md requirements vs. test coverage vs. implementation).
