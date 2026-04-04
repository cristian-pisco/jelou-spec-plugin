# TDD Test Tier Optimization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce full test suite runs from 20-36 per task to exactly 1, eliminating Testcontainer-induced memory exhaustion during TDD cycles.

**Architecture:** The codebase analyzer detects heavy test infrastructure (Testcontainers, Docker-based test dependencies) and documents test filtering commands in CONVENTIONS.md. The test-writer agent becomes tier-aware: it writes fast unit/mock tests during TDD and flags which requirements need integration tests at final validation. The execute-task workflow uses filtered test commands during Red/Green/Refactor steps and reserves the full suite for Step 8 (final validation). Build validation drops test runs entirely and only checks compilation. Per-phase QA becomes static analysis only.

**Tech Stack:** Markdown agent definitions, orchestrator workflow (markdown)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `agents/jlu-codebase-analyzer-operational.md` | Modify | Add heavy test infrastructure detection + test filtering command discovery to CONVENTIONS.md output |
| `agents/jlu-test-writer.md` | Modify | Add test tier awareness: unit/mock during TDD, integration test annotations for final validation |
| `agents/jlu-implementer.md` | Modify | Run only phase test files instead of full suite |
| `agents/jlu-qa-agent.md` | Modify | Per-phase becomes static-only (no test run). Final validation runs the full suite (the single run). |
| `agents/jlu-build-validator.md` | Modify | Remove test suite execution. Build/compile check only. |
| `jelou/workflows/execute-task.md` | Modify | Filtered test commands in 7d/7e/7g, static QA in 7h, no tests in 7k, full suite only in Step 8. Container cleanup. |
| `jelou/references/tdd-cycle.md` | Modify | Document test tiers and the "1 full run" philosophy |
| `jelou/templates/proposal.md` | Modify | Split testing strategy into TDD-tier and integration-tier sections |

---

### Task 1: Add Heavy Test Infrastructure Detection to Codebase Analyzer

**Files:**
- Modify: `agents/jlu-codebase-analyzer-operational.md:30-62` (CONVENTIONS.md output structure)

This is the foundation. The analyzer already scans for testing conventions. It needs to also detect Testcontainers, Docker-based test setups, and discover how to run a filtered subset of tests.

- [ ] **Step 1: Add "Test Infrastructure Weight" section to CONVENTIONS.md template**

In `agents/jlu-codebase-analyzer-operational.md`, find the `## Testing Conventions` line inside the CONVENTIONS.md template (around line 52) and expand it:

```markdown
## Testing Conventions
Test file location (co-located vs separate directory), naming pattern, setup/teardown patterns, mocking approach, assertion style.

### Test Infrastructure Weight
Whether the test suite uses heavy infrastructure that spins up external processes or containers during test runs.

| Signal | Detected | Details |
|--------|----------|---------|
| Testcontainers | yes/no | Library, which tests use it, what containers are spawned |
| Docker-in-test | yes/no | docker-compose.test.yml or similar test-specific compose files |
| In-memory databases | yes/no | SQLite, H2, or embedded alternatives used in tests |
| External service dependencies | yes/no | Tests that require running services (Redis, Postgres, Kafka, etc.) |

**Weight classification**: lightweight (unit + mocks only) | mixed (some tests use heavy infra) | heavy (most tests require containers/external services)

### Test Filtering Commands
How to run a subset of tests by type or path. The AI must discover these from the project's test framework configuration.

| Filter | Command | Notes |
|--------|---------|-------|
| Run specific files only | `<command>` | e.g., `jest path/to/test.spec.ts` or `pytest path/to/test.py` |
| Run unit tests only | `<command>` | e.g., `jest --testPathPattern=unit` or `pytest -m "not integration"` |
| Run integration tests only | `<command>` | e.g., `jest --testPathPattern=integration` or `pytest -m integration` |
| Run all tests | `<command>` | The standard full suite command |

If the project has no explicit test type separation (no directories, no tags, no naming convention distinguishing unit from integration), document that and note: "Test filtering not available — all tests run together."
```

- [ ] **Step 2: Add detection instructions to the Investigation Process**

In the same file, find `## Investigation Process` (line 21) and add a new step after step 3:

```markdown
4. **Detect test infrastructure weight**: Search for heavy test dependencies and filtering capabilities:
   - Grep for `testcontainers`, `TestContainers`, `@Testcontainers`, `GenericContainer`, `PostgreSQLContainer`, `DockerComposeContainer` in source and test files
   - Grep for `docker-compose.test`, `docker-compose.ci`, `docker-compose.integration` files
   - Check if test directories separate unit from integration (e.g., `test/unit/`, `test/integration/`, `__tests__/unit/`, `__tests__/integration/`)
   - Check test framework config for test path patterns, tags, or markers (Jest config `projects` or `testMatch`, pytest markers, Go build tags)
   - Check package.json scripts for separate test commands (e.g., `test:unit`, `test:integration`, `test:e2e`)
   - Determine the command to run only specific test files (framework-dependent: Jest accepts file paths as args, pytest accepts file paths, Go uses `-run` flag)
```

- [ ] **Step 3: Commit**

```bash
git add agents/jlu-codebase-analyzer-operational.md
git commit -m "feat(codebase-analyzer): detect heavy test infrastructure and filtering commands"
```

---

### Task 2: Make Test-Writer Tier-Aware

**Files:**
- Modify: `agents/jlu-test-writer.md`

The test-writer currently writes all test types indiscriminately. It needs to understand that during TDD cycles, it writes fast unit/mock tests only. Integration tests that need Testcontainers or real services are written as separate files clearly marked for final validation.

- [ ] **Step 1: Add Test Tier section after "Context You Must Read" (line 39)**

```markdown
## Test Tiers

You write tests in two tiers. The orchestrator tells you which tier to use via a `TEST_TIER` instruction in your prompt.

### Tier 1: TDD Cycle (default)
Write fast, isolated tests that do NOT depend on external infrastructure:
- **DO**: Use mocks, stubs, fakes, in-memory implementations
- **DO**: Test business logic, validation, transformations, error handling
- **DO**: Mock database calls, HTTP clients, message queue producers/consumers
- **DO**: Use the project's existing mocking patterns from CONVENTIONS.md
- **DO NOT**: Use Testcontainers or any library that spawns Docker containers
- **DO NOT**: Require a running database, cache, or message queue
- **DO NOT**: Make real HTTP calls to external services
- **DO NOT**: Import test utilities that boot infrastructure (e.g., `setupTestDatabase()`, `startTestContainer()`)

These tests must run in under 5 seconds for the entire phase. They are your TDD feedback loop.

### Tier 2: Final Validation
Write integration tests that verify real infrastructure wiring:
- **DO**: Use Testcontainers, real database connections, real message queues
- **DO**: Test the actual repository/DAO layer against a real database
- **DO**: Test real HTTP calls between services (if applicable)
- **DO**: Follow the project's existing integration test patterns from CONVENTIONS.md

These tests run exactly once, at the end of the task, during final validation.

### How to Apply Tiers

When `TEST_TIER: 1` (or no tier specified):
- Write ALL tests as Tier 1 (fast, mocked)
- If a requirement CANNOT be meaningfully tested without real infrastructure (e.g., "verify the database migration creates the correct index"), note it in your report under "Deferred to Tier 2" with a brief explanation

When `TEST_TIER: 2`:
- Write integration tests for requirements that were deferred from Tier 1
- Write integration tests for critical paths identified in SPEC.md (auth, data persistence, cross-service contracts)
- Place these in the project's integration test directory/naming convention per CONVENTIONS.md
- These tests CAN use Testcontainers and real infrastructure

### File Separation
Tier 1 and Tier 2 tests MUST be in separate files so the orchestrator can run them independently. Follow the project's convention for naming:
- If the project separates by directory: `test/unit/` vs `test/integration/`
- If the project separates by name: `*.spec.ts` vs `*.integration.spec.ts` or `*.test.ts` vs `*.integration.test.ts`
- If no convention exists: use a `.integration` suffix (e.g., `auth.integration.spec.ts`)
```

- [ ] **Step 2: Update the Output section to include tier information**

Find the `### Report to Orchestrator` section (line 108) and add a tier report after the existing template:

```markdown
### Tier 2 Deferred
| Requirement | Reason | Integration Test Needed |
|-------------|--------|------------------------|
| FR-3 | Requires real database to verify constraint | DB persistence test |
| NFR-1 | Latency SLA needs real HTTP roundtrip | E2E latency test |
```

- [ ] **Step 3: Update the Rules section**

Add to the Rules section at the bottom of the file:

```markdown
- Respect the TEST_TIER instruction. If Tier 1, never import Testcontainers or infrastructure-dependent test utilities.
- When in doubt about whether a test needs real infrastructure, write it as Tier 1 (mocked). A mocked test that exists is better than an integration test deferred.
```

- [ ] **Step 4: Commit**

```bash
git add agents/jlu-test-writer.md
git commit -m "feat(test-writer): add test tier awareness for TDD vs final validation"
```

---

### Task 3: Update Implementer to Run Only Phase Tests

**Files:**
- Modify: `agents/jlu-implementer.md:61-66` (Step 4: Run Tests)

The implementer currently runs the full test suite for regression checking. It should only run the phase's test files.

- [ ] **Step 1: Replace Step 4 in the implementer agent**

Find Step 4 (lines 61-66) and replace it:

```markdown
### Step 4: Run Tests
Use `Bash` to run the tests. **If the orchestrator provided a `DOCKER_EXEC_PREFIX` in your execution environment, prefix ALL test, lint, and build commands with it.** File read/write operations always run on the host.
1. Run ONLY the test files from this phase — use the exact file paths from the test-writer's report. Example: `jest path/to/phase-test.spec.ts` or `pytest path/to/test_phase.py`
2. All phase tests must PASS (Green)
3. If any test fails, analyze and fix your implementation (not the test)

Do NOT run the full test suite. Regression checking happens once at final validation (Step 8). Running only phase tests keeps the TDD feedback loop fast and avoids booting heavy test infrastructure.
```

- [ ] **Step 2: Commit**

```bash
git add agents/jlu-implementer.md
git commit -m "feat(implementer): run only phase test files instead of full suite"
```

---

### Task 4: Convert Per-Phase QA to Static Analysis Only

**Files:**
- Modify: `agents/jlu-qa-agent.md:13-89` (Per-Phase Validation section)

Per-phase QA currently runs the full test suite again. It should only read code and check conventions. No test execution.

- [ ] **Step 1: Replace the Per-Phase Validation section**

Find `## Per-Phase Validation` (line 13) and replace everything up to the `## Final Validation` section (line 92):

```markdown
## Per-Phase Validation

Run after each phase's Green step (tests passing). This is a static code review — no test execution. Tests were already verified green by the implementer.

### Checklist:

#### 1. Code Follows Conventions
- Read the new/modified files
- Read CONVENTIONS.md for the service
- Verify:
  - Naming conventions match
  - File placement matches STRUCTURE.md
  - Error handling follows established patterns
  - Import organization is consistent
  - Code formatting matches (no linter would complain)

#### 2. Phase Requirements Met
- Read the phase file's requirements section
- Verify each requirement has corresponding tests (read the test files, don't run them)
- Verify tests are meaningful (not tautological)

#### 3. No Obvious Issues
- Check for hardcoded values that should be configurable
- Check for missing error handling on new code paths
- Check for console.log/print statements that should be proper logging
- Check for commented-out code

#### 4. Function Length
- Check all new or modified functions/methods
- No function should exceed 100 lines
- If found, report as FAIL with recommendation to refactor

#### 5. Test Tier Compliance
- Verify that Tier 1 test files do NOT import Testcontainers, database connection utilities, or other heavy infrastructure
- If Tier 1 tests depend on real infrastructure, report as FAIL — the test-writer wrote the wrong tier

### Per-Phase Output:

```
## QA Report — Phase <N> (Per-Phase)

### Status: PASS | FAIL

### Convention Compliance
- **Naming**: PASS | <issues>
- **File placement**: PASS | <issues>
- **Error handling**: PASS | <issues>
- **Formatting**: PASS | <issues>

### Requirements Coverage
| Requirement | Tested | Implemented | Notes |
|-------------|--------|-------------|-------|
| FR-1 | Yes | Yes | |
| FR-2 | Yes | Yes | |

### Test Tier Compliance
- Tier 1 tests are infrastructure-free: PASS | <violations>

### Issues Found
- <list of issues, or "None">

### Verdict
PASS — phase may proceed.
FAIL — <reason, what needs to be fixed before proceeding>
```

**Important**: Do NOT run the test suite during per-phase validation. The implementer already verified tests are green. Your job is to review the code, not re-run tests. Test execution happens exactly once, during Final Validation.
```

- [ ] **Step 2: Commit**

```bash
git add agents/jlu-qa-agent.md
git commit -m "feat(qa-agent): convert per-phase validation to static analysis only"
```

---

### Task 5: Remove Test Execution from Build Validator

**Files:**
- Modify: `agents/jlu-build-validator.md`

The build validator currently runs the full test suite after each build fix. It should only verify compilation.

- [ ] **Step 1: Replace the Test Command Detection section and Fix Loop**

Remove the entire `## Test Command Detection` section (lines 27-34).

Replace the `## Fix Loop` section (lines 36-55) with:

```markdown
## Fix Loop

Execute this loop:

### Round N:

1. **Run build command** using `Bash`.
   - If the orchestrator provided a `DOCKER_EXEC_PREFIX` in your execution environment, prefix the build command with it.
2. **If build passes** → done. Report PASS.
3. **If build fails** → parse the compiler/build error output.
   - Read the failing source files.
   - Fix the issues (missing imports, type errors, unresolved references, etc.).
   - Start the next round.

### Limits

- Maximum **5 rounds**. If after 5 rounds the build still fails, report FAIL with the last error output and stop. The orchestrator will escalate to the user.
```

- [ ] **Step 2: Update the Output template**

Replace the output template to remove test references:

```markdown
## Output

After completing the fix loop (or on SKIP/FAIL), provide a structured report:

```
## Build Validation Report — Phase <NN>

### Status: PASS | SKIP | FAIL

### Build
- **Command**: `<exact command>`
- **Result**: success | skipped (no build configured)

### Fixes Applied
| File | Issue | Fix |
|------|-------|-----|
| `src/auth/auth.service.ts` | Missing import `JwtService` | Added import from `@nestjs/jwt` |

### Fix Rounds
- Round 1: 2 build errors → fixed 2 files
- Round 2: build passes
- Total rounds: 2

### Verdict
PASS — build verified.
SKIP — no build command detected for this service.
FAIL — build still failing after 5 rounds. Last error: <error summary>
```

If no fixes were needed, omit the "Fixes Applied" and "Fix Rounds" sections.
```

- [ ] **Step 3: Update the Rules section**

Remove the rule about running tests. The rules should be:

```markdown
## Rules

- You fix production code ONLY. Never modify test files.
- Match the existing codebase conventions exactly. Your fixes should look like existing code.
- If the orchestrator provided a `DOCKER_EXEC_PREFIX`, prefix ALL build and framework commands with it. File reads/writes (Read, Write, Glob, Grep) operate on the host filesystem.
- Read the build error output carefully — fix the root cause, not symptoms.
- If a fix requires architectural changes beyond simple corrections (missing imports, type annotations, export statements), report FAIL and let the orchestrator escalate.
- Keep fixes minimal. Do not refactor, improve, or gold-plate code while fixing build errors.
- Do NOT run the test suite. Build validation checks compilation only. Tests are verified once at final validation.
```

- [ ] **Step 4: Commit**

```bash
git add agents/jlu-build-validator.md
git commit -m "feat(build-validator): remove test execution, compile-check only"
```

---

### Task 6: Update Execute-Task Workflow — The Core Change

**Files:**
- Modify: `jelou/workflows/execute-task.md`

This is the orchestrator. Every verification step changes. This is where the "1 full run" policy gets enforced.

- [ ] **Step 1: Update Step 7d (TDD Red) — run only new test files**

Find the `### 7d. TDD Red — Spawn Test Writer` section (line 215). Add `TEST_TIER: 1` to the agent input and replace the Red verification block (lines 235-243):

In the **Input** section, add after the existing bullets:

```markdown
  - `TEST_TIER: 1` (TDD cycle — fast, isolated tests only)
```

Replace the **Red verification** block with:

```markdown
**Red verification**:
1. Run ONLY the new test files produced by the test-writer (use exact file paths from the agent's report).
   - Example: `<DOCKER_EXEC_PREFIX> jest path/to/new-test.spec.ts` or `<DOCKER_EXEC_PREFIX> pytest path/to/new_test.py`
   - Do NOT run the full test suite.
2. Confirm the new tests FAIL (Red state).
3. If any new tests PASS unexpectedly:
   - Log to terminal: "Test `<test-name>` passes without implementation — auto-investigating."
   - Spawn a fresh `jlu-test-writer` with model: **MODEL_CONFIG.code** (default: sonnet) to evaluate whether the test is correct or the requirement is already implemented.
   - If already implemented: mark requirement as covered, skip to next.
   - If test is incorrect: rewrite and re-verify Red state.
```

- [ ] **Step 2: Update Step 7e (TDD Green) — run only phase test files**

Find `### 7e. TDD Green — Spawn Implementer` (line 244). Replace the **Green verification** block (lines 262-269):

```markdown
**Green verification**:
1. Run ONLY the phase test files (use the exact file paths from the test-writer's report).
   - Example: `<DOCKER_EXEC_PREFIX> jest path/to/phase-test.spec.ts` or `<DOCKER_EXEC_PREFIX> pytest path/to/test_phase.py`
   - Do NOT run the full test suite. Regression checking happens once at Step 8.
2. Confirm all phase tests PASS (Green state).
3. If tests still fail after implementation:
   - Log failures to terminal.
   - Spawn a fresh `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) and accumulated failure context (Decision #1).
   - Retry up to 5 times total.
   - If still failing after 5 attempts: pause and notify user (see Escalation Format below).
```

- [ ] **Step 3: Update Step 7g (Refactor) — run only phase test files**

Find `### 7g. Refactor Pass (Optional)` (line 284). Replace line 292:

```markdown
2. If changes are made, re-run ONLY the phase test files to confirm Green is maintained. Do not run the full suite.
```

- [ ] **Step 4: Update Step 7h (Per-Phase QA) — static analysis only**

Find `### 7h. Per-Phase QA (Decision #13)` (line 294). Replace the entire section:

```markdown
### 7h. Per-Phase QA (Decision #13)

Spawn `jlu-qa-agent` with model: **MODEL_CONFIG.code** (default: sonnet) for a static per-phase review:
- Phase file with requirements
- List of files created/modified in this phase
- `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/STRUCTURE.md`

The QA agent performs static analysis ONLY — it reads code and checks conventions. It does NOT run tests. Test execution is reserved for Step 8.

If QA finds code quality issues (convention violations, function length, test tier violations):
- Log issues to terminal.
- Attempt to fix automatically: spawn `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) and QA findings.
- After fix, re-run ONLY the phase test files to confirm Green is maintained.
- Retry up to 5 times total.
- If still failing after 5 attempts: pause and notify user (see Escalation Format below).
```

- [ ] **Step 5: Update Step 7k (Build Validation) — compile only, no tests**

Find `### 7k. Build Validation` (line 326). Replace the entire section:

```markdown
### 7k. Build Validation

Spawn `jlu-build-validator` agent with model: **MODEL_CONFIG.code** (default: sonnet):
- **Input**:
  - Service source path (worktree or repo)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Phase context (phase number, service-id)
- **Docker context** (only if `IS_DOCKER_SERVICE` is true): Include the same `## Execution Environment` block as in Step 7d. Omit for non-Docker services.
- **Task**: Run the project build command and fix any compilation failures. Do NOT run the test suite.

**If the agent reports PASS** (with or without fixes):
- If fixes were applied: re-run ONLY the phase test files to confirm Green is maintained. Then re-spawn `jlu-git-agent` with model: **MODEL_CONFIG.operational** (default: haiku) to commit the build fixes (message: `fix(<service>): resolve build errors from phase <NN>`).
- If no fixes needed: continue to 7l.

**If the agent reports SKIP** (no build command detected):
- Continue to 7l. No action needed.

**If the agent reports FAIL** (5 rounds exhausted):
- Pause and notify user (see Escalation Format below).
```

- [ ] **Step 6: Add container cleanup to Step 7l (Complete Phase)**

Find `### 7l. Complete Phase` (line 344). Add after the existing content:

```markdown
4. **Container cleanup** (Docker-enabled services only):
   ```bash
   docker container prune -f 2>/dev/null || true
   ```
   Remove any orphaned containers from interrupted test runs to prevent memory accumulation across phases.
```

- [ ] **Step 7: Update Step 8 (Final Validation) — the single full run**

Find `## Step 8 — Final Validation` (line 362). Replace the entire section:

```markdown
## Step 8 — Final Validation

After all phases are complete, this is the SINGLE full test suite run for the entire task.

### 8a. Write Tier 2 Integration Tests

For each service that has Tier 2 deferred requirements (from test-writer reports across phases):
1. Collect all deferred requirements from phase files.
2. Spawn `jlu-test-writer` with model: **MODEL_CONFIG.code** (default: sonnet):
   - **Input**: Deferred requirements list, CONVENTIONS.md, service source path
   - **TEST_TIER: 2** (integration tests — Testcontainers and real infrastructure allowed)
   - **Docker context**: Include if applicable
   - **Task**: Write integration tests for all deferred requirements.
3. Spawn `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) if the integration tests reveal missing wiring (e.g., a repository method needs a real database query that was mocked in Tier 1).

### 8b. Full Test Suite Run

This is the only time the full test suite runs during the entire task execution.

1. **Container cleanup first**:
   ```bash
   docker container prune -f 2>/dev/null || true
   ```

2. Run the complete test suite for each affected service:
   - Use the full test command from CONVENTIONS.md (e.g., `npm test`, `pytest`, `go test ./...`)
   - If Docker-enabled: `<DOCKER_EXEC_PREFIX> <full test command>`
   - This includes ALL tests: unit, integration, Testcontainer-based, e2e
   
3. If tests fail:
   - Analyze failures: are they Tier 1 tests (regression) or Tier 2 tests (new integration tests)?
   - Spawn `jlu-implementer` to fix. Retry up to 5 times.
   - If still failing after 5 attempts: pause and notify user.

### 8c. Comprehensive QA

Spawn `jlu-qa-agent` with model: **MODEL_CONFIG.code** (default: sonnet) for comprehensive final validation:
- **Docker context** (only if `IS_DOCKER_SERVICE` is true): Include the `## Execution Environment` block. Omit for non-Docker services.
- **Full coverage analysis**: Are all requirements from SPEC.md covered by tests?
- **Edge case review**: Were edge cases from the spec addressed?
- **Cross-service contract verification** (if multi-service): Do the services communicate correctly? Are contracts honored?
- **Convention compliance**: Final check against CONVENTIONS.md
- **Code smell detection**: Full structural review
- **Over-engineering detection**: Verify minimum viable implementation

The QA agent MAY run the test suite during final validation — this is the sanctioned full run.

Log the validation results to terminal:
```
## Final Validation Results

### Coverage
- Requirements covered: <N>/<total>
- Test suites passing: <N>/<total>
- Tier 1 (unit/mock) tests: <count>
- Tier 2 (integration) tests: <count>

### Issues Found
- <issue-1>
- <issue-2>

### Cross-Service Contracts
- <contract check results>
```

### 8d. Post-Validation Cleanup

For Docker-enabled services, clean up Testcontainer instances:
```bash
docker container prune -f 2>/dev/null || true
```
```

- [ ] **Step 8: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "feat(execute-task): single full test run at final validation, filtered tests during TDD"
```

---

### Task 7: Update TDD Cycle Reference

**Files:**
- Modify: `jelou/references/tdd-cycle.md`

Document the test tier philosophy so agents have a shared reference.

- [ ] **Step 1: Add Test Tiers section after "Coverage Requirements" (line 76)**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add jelou/references/tdd-cycle.md
git commit -m "docs(tdd-cycle): document test tier strategy and single-run philosophy"
```

---

### Task 8: Update Proposal Template

**Files:**
- Modify: `jelou/templates/proposal.md:67-82` (Testing Strategy section)

The proposal template should reflect the tiered testing approach so the proposal agent structures its output correctly.

- [ ] **Step 1: Replace the Testing Strategy section**

Find `## Testing Strategy` (line 67) and replace through line 82:

```markdown
## Testing Strategy

### Tier 1: TDD Cycle (unit + mocks)
<!-- Fast tests that run during Red-Green-Refactor. No external infrastructure.
     What business logic, validation, transformations will be unit-tested?
     What will be mocked (databases, HTTP clients, message queues)?
     What mocking patterns does the project use (from CONVENTIONS.md)? -->

### Tier 2: Final Validation (integration + real infrastructure)
<!-- Tests that run once at the end. Real databases, Testcontainers, real services.
     Which requirements CANNOT be meaningfully tested with mocks?
     What integration tests are needed (DB persistence, API contracts, event flows)?
     What Testcontainer images are needed? -->

### E2E Tests
<!-- End-to-end test scenarios when applicable.
     Maps to user stories and acceptance criteria. -->
```

- [ ] **Step 2: Commit**

```bash
git add jelou/templates/proposal.md
git commit -m "feat(proposal-template): split testing strategy into Tier 1 and Tier 2 sections"
```

---

## Verification Checklist

After all tasks are complete, verify the changes are consistent:

- [ ] `agents/jlu-codebase-analyzer-operational.md` — has Test Infrastructure Weight and Test Filtering Commands sections in CONVENTIONS.md template
- [ ] `agents/jlu-test-writer.md` — has Test Tiers section, respects TEST_TIER instruction, reports Tier 2 deferrals
- [ ] `agents/jlu-implementer.md` — runs only phase test files, never the full suite
- [ ] `agents/jlu-qa-agent.md` — per-phase is static-only (no test execution), final validation runs tests
- [ ] `agents/jlu-build-validator.md` — compile/typecheck only, no test execution
- [ ] `jelou/workflows/execute-task.md` — 7d/7e/7g use filtered commands, 7h is static, 7k has no tests, Step 8 is the single full run with Tier 2 test writing
- [ ] `jelou/references/tdd-cycle.md` — documents test tiers and the "1 full run" philosophy
- [ ] `jelou/templates/proposal.md` — testing strategy split into Tier 1 and Tier 2

## Test Run Count: Before vs After

| Step | Before | After |
|------|--------|-------|
| 7d Red verification | Full suite (1x) | Phase files only (1x) |
| 7e Green verification | Full suite (1-5x) | Phase files only (1-5x) |
| 7g Refactor | Full suite (1x) | Phase files only (0-1x) |
| 7h QA per-phase | Full suite (1x) | None (static) |
| 7k Build validation | Full suite (1x) | None (compile only) |
| Step 8 Final | Full suite (1x) | **Full suite (1x)** |
| **Total full suite runs per phase** | **5-9** | **0** |
| **Total full suite runs per task** | **20-36** | **1** |
