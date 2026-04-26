# Loading Context — Shared Reference

> Both `jlu-ui-e2e-writer` (RED phase) and `jlu-ui-fix-loop` (post-deploy fix loop) need to load the same task context. This reference is the single source of truth for that loading flow. Both agents cite it; neither duplicates the logic.

## Inputs the orchestrator provides

When dispatching either agent, the orchestrator passes:

- `<TASK_DIR>` — absolute path to `.spec-workspace/specs/<date>/<task>/`
- `<UI_SERVICE_ID>` — the UI service this dispatch targets (e.g., `service-frontend`)
- `<UI_SERVICE_WORKTREE>` — absolute path to the active worktree for `<UI_SERVICE_ID>`, resolved by jelou-spec-plugin's `worktree-resolution.md` algorithm. **Do not use `services.yaml[*].path` directly** — it points at the canonical source tree, which may not be the active worktree for the current task (per design Premise 10).

## What to load (in order)

### 1. SPEC.md

`<TASK_DIR>/SPEC.md` — read top-to-bottom. Extract:

- **`user-flow.md` blocks**, where present. Filter to those whose `Affected UI Service` matches `<UI_SERVICE_ID>`.
- **`ui-component.md` blocks**, where present. These are component-grade; the writer agent does not consume them directly but should know they exist for context.
- The task's high-level Problem Statement (above the first template block) — useful for naming and scoping.

### 2. TASKS.md (frontmatter)

`<TASK_DIR>/TASKS.md` — read the YAML frontmatter at the top. Extract `affected_services`. This is the structured source of truth.

If frontmatter is absent (legacy task), fall back to parsing the `## Services` section's headings as service ids and the per-service `Status` line as `sub_state`. Note in your report: "TASKS.md has no frontmatter — using legacy fallback."

### 3. services.yaml

`<WORKSPACE_PATH>/registry/services.yaml` — read the entry for `<UI_SERVICE_ID>`. Extract `path` (canonical source path; informational only — DO NOT use as the active worktree) and `dev` block (informational for the writer; load-bearing for the fix-loop's pre-flight).

### 4. selectors.md (optional)

`<TASK_DIR>/selectors.md` if present — declared `data-testid` ids the writer is allowed to emit and the fix-loop is allowed to assert against.

### 5. Consumer service Playwright config

`<UI_SERVICE_WORKTREE>/playwright.config.ts` (or `.js`, `.cjs`, `.mjs`) — read for:

- `baseURL` — used in test goto calls.
- `projects` — match the project name when the consumer has multiple (desktop, mobile).
- `globalSetup` / `globalTeardown` — preserve the consumer's hooks; never override them.
- Auth fixture import path conventions (look at `<UI_SERVICE_WORKTREE>/tests/e2e/` for examples).

If `playwright.config.ts` is absent: the consumer hasn't initialized Playwright. **The writer should write tests assuming the implementer will run `npm init playwright@latest` during GREEN**, and add a one-line note to INDEX.md that the consumer needs Playwright initialized before the tests can run.

### 6. Existing E2E tests

`<UI_SERVICE_WORKTREE>/tests/e2e/` (or wherever the consumer keeps them) — list 1-2 existing `.spec.ts` files. Use them to learn:

- Naming convention (`feature-name.spec.ts` vs `featureName.test.ts`).
- Fixture import path (`./fixtures/auth.ts` vs `@/test-fixtures/auth`).
- Whether the consumer uses `test.beforeEach` or `test.beforeAll` for auth.
- Whether the consumer extends Playwright's base test with custom fixtures.

If no existing tests: emit a brand-new file at `<UI_SERVICE_WORKTREE>/tests/e2e/<flow-slug>.spec.ts` and a `<UI_SERVICE_WORKTREE>/tests/e2e/fixtures/auth.ts` stub that the implementer must complete during GREEN.

## Where to write

Both agents write artifacts to `<TASK_DIR>/services/<UI_SERVICE_ID>/e2e/`, never directly into the consumer service tree. The hand-off into the consumer's `<UI_SERVICE_WORKTREE>/tests/e2e/` happens later — for the writer, this is on `/jlu-create-pr` (mirroring jelou-spec-plugin's backend test hand-off pattern); for the fix-loop, this is implicit (the fix-loop reads tests from the consumer's tests/e2e/ at runtime, since by then they've already been moved).

## Worktree resolution example

```
TASKS.md → ## Branching → Mode: worktree
services.yaml → service-frontend → path: ../service-frontend

Active worktree = ../service-frontend/.worktrees/<task-slug>/
NOT             = ../service-frontend/

The orchestrator pre-resolves this and passes it as UI_SERVICE_WORKTREE.
The agent uses UI_SERVICE_WORKTREE verbatim.
```

If `Mode: branch` (no worktree), the active worktree IS the canonical source tree, and `UI_SERVICE_WORKTREE == <WORKSPACE_PATH>/<service.path>`. The orchestrator handles this resolution; the agent doesn't care.

## Don't reinvent

This is a reference, not a runtime. The agents follow this flow but the orchestrator does the actual file resolution and passes paths in via the dispatch. If the dispatch is missing a required input, the agent escalates `NEEDS_CONTEXT` rather than guessing.
