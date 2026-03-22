# Build Validator Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `jlu-build-validator` agent that validates project builds after each TDD phase and auto-fixes build errors, then integrate it into the `execute-task` workflow as Step 7k.

**Architecture:** A new agent (`agents/jlu-build-validator.md`) runs the project's build command, parses errors, fixes source files, and verifies tests still pass — looping up to 5 rounds. The `execute-task` workflow dispatches it after git commit (7j) and before phase completion (renumbered to 7l).

**Tech Stack:** Claude Code plugin agents (Markdown prompt files), no runtime code.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `agents/jlu-build-validator.md` | Agent definition: build command detection, fix loop, output format, rules |
| Modify | `jelou/workflows/execute-task.md` (Step 7) | Add Step 7k (build validation), renumber 7k→7l, add error handling entry |

---

### Task 1: Create the build-validator agent

**Files:**
- Create: `agents/jlu-build-validator.md`

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-03-22-build-validator-agent-design.md` (full agent definition, fix loop, output format, rules)
- Existing agent pattern: `agents/jlu-implementer.md` (frontmatter format, Docker context handling, convention-following rules)
- Docker context block: `jelou/workflows/execute-task.md` lines 262-270 (the `## Execution Environment` block format)

- [ ] **Step 1: Write the agent frontmatter**

```markdown
---
name: jlu-build-validator
description: "Validates project build and auto-fixes build errors after each phase"
tools: Read, Write, Bash, Glob, Grep
model: sonnet
---
```

Follow the same frontmatter pattern as `agents/jlu-implementer.md`. Tools include Write (needed to fix source files).

- [ ] **Step 2: Write the Mission section**

```markdown
You are the build validator agent for the Jelou Spec Plugin. Your job is to verify that the project builds successfully after each TDD phase, and auto-fix any build errors that are found.

## Mission

After the implementer makes tests green and code is committed, run the project's build command to catch compilation errors (missing imports, type errors, unresolved references) that tests alone don't catch. If the build fails, fix the source code and verify both build and tests pass.
```

- [ ] **Step 3: Write the Build Command Detection section**

Document the priority order from the spec. Include exact file paths to check and commands to derive:

```markdown
## Build Command Detection

Detect the build command in this priority order:

1. **CONVENTIONS.md** — Read CONVENTIONS.md for an explicit build command (e.g., a "Build" or "Scripts" section).
2. **package.json** — Read `package.json` and check `scripts.build`. If present → `npm run build`.
3. **tsconfig.json** — Check if `tsconfig.json` exists in the project root. If present → `tsc --noEmit`.
4. **Makefile** — Check if `Makefile` exists with a `build` target. If present → `make build`.
5. **No build configured** — If none of the above are found, report SKIP and stop.

All detected commands must be executed via `DOCKER_EXEC_PREFIX` when the service is Docker-enabled. For example: `<DOCKER_EXEC_PREFIX> npm run build`. File read/write operations always run on the host filesystem.
```

- [ ] **Step 4: Write the Test Command Detection section**

```markdown
## Test Command Detection

Detect the test command in this priority order:

1. **CONVENTIONS.md** — Read CONVENTIONS.md for an explicit test command.
2. **package.json** — Read `package.json` and check `scripts.test`. If present → `npm test`.
3. **Makefile** — Check if `Makefile` exists with a `test` target. If present → `make test`.
4. **Phase file fallback** — Read the phase file's Execution section for the test command used by the test-writer/implementer agents earlier in the phase.

All detected commands must be executed via `DOCKER_EXEC_PREFIX` when the service is Docker-enabled.
```

- [ ] **Step 5: Write the Fix Loop section**

Document the core loop with the 5-round limit:

```markdown
## Fix Loop

Execute this loop:

### Round N:

1. **Run build command** using `Bash`.
   - If the orchestrator provided a `DOCKER_EXEC_PREFIX` in your execution environment, prefix the build command with it.
2. **If build passes** → run the full test suite.
   - If tests pass → done. Report PASS.
   - If tests fail → this is a regression from your fix. Parse the test failures, fix the source code, and start the next round.
3. **If build fails** → parse the compiler/build error output.
   - Read the failing source files.
   - Fix the issues (missing imports, type errors, unresolved references, etc.).
   - Start the next round.

### Limits

- Maximum **5 rounds**. If after 5 rounds the build or tests still fail, report FAIL with the last error output and stop. The orchestrator will escalate to the user.

### Fix Guidelines

- Only fix production code. Never modify test files.
- Match existing codebase conventions when writing fixes (read CONVENTIONS.md).
- Fix the root cause, not symptoms. If the error says "Cannot find module X", check why X isn't exported or imported — don't just suppress the error.
- If a fix requires architectural changes (not just missing imports/types), stop and report FAIL with an explanation. Example: adding a missing import = fix; restructuring a module's dependency graph = escalate.
```

- [ ] **Step 6: Write the Output Format section**

Copy the output format from the spec verbatim:

```markdown
## Output

After completing the fix loop (or on SKIP/FAIL), provide a structured report:

\```
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
\```

If no fixes were needed, omit the "Fixes Applied" and "Fix Rounds" sections.
```

- [ ] **Step 7: Write the Rules section**

```markdown
## Rules

- You fix production code ONLY. Never modify test files.
- Match the existing codebase conventions exactly. Your fixes should look like existing code.
- If the orchestrator provided a `DOCKER_EXEC_PREFIX`, prefix ALL build, test, lint, and framework commands with it. File reads/writes (Read, Write, Glob, Grep) operate on the host filesystem.
- Read the build error output carefully — fix the root cause, not symptoms.
- If a fix requires architectural changes beyond simple corrections (missing imports, type annotations, export statements), report FAIL and let the orchestrator escalate.
- Keep fixes minimal. Do not refactor, improve, or gold-plate code while fixing build errors.
```

- [ ] **Step 8: Verify the agent file is complete**

Read `agents/jlu-build-validator.md` end-to-end. Verify it has:
1. YAML frontmatter (name, description, tools, model)
2. Mission section
3. Build Command Detection section
4. Test Command Detection section
5. Fix Loop section with 5-round limit
6. Output format section
7. Rules section

Compare structure against `agents/jlu-implementer.md` to ensure consistent pattern.

- [ ] **Step 9: Commit**

```bash
git add agents/jlu-build-validator.md
git commit -m "Add jlu-build-validator agent definition"
```

---

### Task 2: Integrate into execute-task workflow

**Files:**
- Modify: `jelou/workflows/execute-task.md` (Step 7 section, lines 211-363; Error Handling table, lines 437-449)

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-03-22-build-validator-agent-design.md` (Step 7k definition, workflow integration)
- Current workflow: `jelou/workflows/execute-task.md` (current Step 7k at lines 359-363, Docker context block at lines 262-270)

- [ ] **Step 1: Add Step 7k (Build Validation) to the workflow**

Insert the following after the current Step 7j (Git Commit) section (after line 357) and before the current Step 7k (Complete Phase):

```markdown
### 7k. Build Validation

Spawn `jlu-build-validator` agent:
- **Input**:
  - Service source path (worktree or repo)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Phase context (phase number, service-id)
- **Docker context** (only if `IS_DOCKER_SERVICE` is true): Include the same `## Execution Environment` block as in Step 7d. Omit for non-Docker services.
- **Task**: Run the project build, fix any failures, verify tests still pass.

**If the agent reports PASS** (with or without fixes):
- If fixes were applied: re-spawn `jlu-git-agent` to commit the build fixes (message: `fix(<service>): resolve build errors from phase <NN>`).
- If no fixes needed: continue to 7l.

**If the agent reports SKIP** (no build command detected):
- Continue to 7l. No action needed.

**If the agent reports FAIL** (5 rounds exhausted):
- Report the failure to the user with the agent's last error output.
- In autonomous mode: pause execution and ask the user how to proceed.
- In step-by-step mode: present the failure and ask how to proceed.
```

- [ ] **Step 2: Renumber current 7k to 7l**

Change the current Step 7k header and content:

Before:
```markdown
### 7k. Complete Phase
```

After:
```markdown
### 7l. Complete Phase
```

No other changes to the section content.

- [ ] **Step 3: Add error handling entry**

Add a new row to the Error Handling table (around line 447):

```markdown
| Build validation fails after 5 rounds | Report failure, pause for user intervention |
```

- [ ] **Step 4: Verify the workflow is consistent**

Read `jelou/workflows/execute-task.md` end-to-end. Verify:
1. Step 7k (Build Validation) exists between 7j and 7l
2. Step 7l (Complete Phase) is correctly renumbered
3. No stale references to "7k" meaning "Complete Phase" remain in the document
4. The new error handling row is present
5. The Docker context block reference in 7k matches the format used in 7d, 7e, 7h

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "Integrate build-validator agent into execute-task as Step 7k"
```

---

## Verification Checklist

After both tasks are complete, verify:

- [ ] `agents/jlu-build-validator.md` exists with correct frontmatter
- [ ] `jelou/workflows/execute-task.md` has Steps 7j → 7k → 7l in order
- [ ] No references to old "7k = Complete Phase" remain in the workflow
- [ ] Error handling table includes build validation failure row
- [ ] Agent file follows the same structural pattern as `jlu-implementer.md`
