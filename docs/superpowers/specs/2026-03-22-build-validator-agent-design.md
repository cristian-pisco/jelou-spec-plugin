# Build Validator Agent Design

> Post-implementation build validation and auto-fix agent for the execute-task workflow.

## Problem

After TDD phase execution completes (tests pass, QA validates, code is committed), the project build can still fail. Common causes: missing imports, type errors, unresolved references. The current QA agent validates tests and code quality but never runs the actual build command. These failures are only discovered later, outside the execution pipeline.

## Solution

A new dedicated agent `jlu-build-validator` that runs the project build after each phase's git commit, and auto-fixes any build failures in a loop until both build and tests pass.

## Agent Definition

- **Name**: `jlu-build-validator`
- **Description**: "Validates project build and auto-fixes build errors after each phase"
- **Model**: Sonnet
- **Tools**: Read, Write, Bash, Glob, Grep
- **Docker-aware**: Yes — uses `DOCKER_EXEC_PREFIX` when provided

## Workflow Integration

Inserted as **Step 7k** in the execute-task workflow, after git commit (7j). The current 7k (Complete Phase) is renumbered to 7l.

### Updated phase flow

```
7d. TDD Red (test-writer)
7e. TDD Green (implementer)
7f. Test Dispute Resolution
7g. Refactor Pass
7h. Per-Phase QA
7i. Update TASKS.md
7j. Git Commit
7k. Build Validation  ← NEW
7l. Complete Phase    ← RENUMBERED from 7k
```

### Step 7k definition

Spawn `jlu-build-validator` agent:
- **Input**:
  - Service source path (worktree or repo)
  - CONVENTIONS.md (for build command detection)
  - Phase context (phase number, service-id)
- **Docker context** (only if `IS_DOCKER_SERVICE` is true): Include the same `## Execution Environment` block as in Step 7d. Omit for non-Docker services.
- **Task**: Run the build, fix any failures, verify tests still pass.

If the agent made fixes:
- Re-spawn `jlu-git-agent` to commit the build fixes (message: `fix(<service>): resolve build errors from phase <NN>`)

If the agent reports PASS with no fixes needed:
- Continue to 7l (no extra commit).

## Build Command Detection

Priority order:
1. Check `CONVENTIONS.md` for an explicit build command
2. Check `package.json` `scripts.build` → `npm run build`
3. Check for `tsconfig.json` → `tsc --noEmit` as fallback
4. Check for `Makefile` with a `build` target → `make build`
5. If none found → report SKIP (no build step configured)

All detected commands must be executed via `DOCKER_EXEC_PREFIX` when the service is Docker-enabled. For example: `<DOCKER_EXEC_PREFIX> npm run build`. File read/write operations always run on the host filesystem.

## Fix Loop

```
1. Run build command
2. If PASS → run full test suite
   - If tests PASS → done, report PASS
   - If tests FAIL → treat as build-fix regression, parse failures, fix, go to 1
3. If FAIL → parse compiler/build errors
   - Read the failing files
   - Fix the issues (missing imports, type errors, etc.)
   - Go to 1
```

The agent loops until both build and tests pass, up to a maximum of **5 rounds**. If after 5 rounds the build or tests still fail, report FAIL and escalate to the orchestrator (which presents the failure to the user).

## Test Command Detection

Priority order (mirrors build command detection):
1. Check `CONVENTIONS.md` for an explicit test command
2. Check `package.json` `scripts.test` → `npm test`
3. Check for `Makefile` with a `test` target → `make test`
4. Fall back to the command used by the test-writer/implementer agents earlier in the phase (visible in the phase file's execution section)

## Output Format

```
## Build Validation Report — Phase <NN>

### Status: PASS | SKIP | FAIL

### Build
- **Command**: `<exact command>`
- **Result**: success | skipped (no build configured)

### Test Suite (post-build)
- **Command**: `<exact command>`
- **Result**: X passing, 0 failing

### Fixes Applied
| File | Issue | Fix |
|------|-------|-----|
| `src/auth/auth.service.ts` | Missing import `JwtService` | Added import from `@nestjs/jwt` |

### Fix Rounds
- Round 1: 2 build errors → fixed 2 files
- Round 2: build passes, tests pass
- Total rounds: 2

### Verdict
PASS — build and tests verified.
SKIP — no build command detected for this service.
FAIL — build/tests still failing after 5 rounds. Last error: <error summary>
```

## Agent Rules

- Never modify test files — only fix production code
- Match existing codebase conventions when writing fixes
- If a fix requires architectural changes (not just missing imports/types), escalate to the orchestrator instead of attempting. Example: adding a missing import = fix; restructuring a module's dependency graph = escalate
- Read the build error output carefully — fix the root cause, not symptoms
- Follow the same Docker context pattern as test-writer and implementer agents
