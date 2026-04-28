# Daily-Slack Closed Percentage Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize `percentage: 100` for any task with `status_type === 'closed'` in `bin/daily-slack-bucket.mjs` so the daily-slack Slack message stops showing `0%` for closed tasks without subtasks.

**Architecture:** Add a module-local `normalizePercentage()` helper to the bucketer. Apply it at two intake points: each task in `current` at the top of the bucket loop, and each entry in the prior snapshot right after parsing. Both points enforce the same rule. Tests use the existing `node --test` runner; no new tooling.

**Tech Stack:** Node.js (ESM, `.mjs`), `node:test` runner, no extra deps. Spec: `docs/superpowers/specs/2026-04-28-daily-slack-closed-percentage-design.md`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `bin/daily-slack-bucket.mjs` | Modify | Add `normalizePercentage()` helper; mutate `t.percentage` in `bucket()` loop and `prior[id].percentage` in `main()` |
| `tests/unit/daily-slack-bucket.test.mjs` | Modify | Append a new `describe` block with 5 tests covering the closed→100 invariant |
| `jelou/workflows/daily-slack.md` | Modify | Append a one-line note at end of Step 6c documenting the invariant |

---

### Task 1: Add a failing test for closed-without-subtasks → 100

**Files:**
- Modify: `tests/unit/daily-slack-bucket.test.mjs` (append new `describe` block at end of file)

- [ ] **Step 1: Append the first failing test**

Open `tests/unit/daily-slack-bucket.test.mjs` and append the following `describe` block at the very end of the file (after the existing "IO and validation errors" block, after its closing `});`):

```js
describe('daily-slack-bucket — closed → 100% normalization', () => {
  test('closed task without subtasks normalizes to 100 in achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'closed' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 50, status_type: 'in_progress' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
    assert.equal(out.achieved[0].percentage, 100);
    assert.equal(out.new_snapshot.a.percentage, 100);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
node --test tests/unit/daily-slack-bucket.test.mjs
```

Expected: the new test fails with an assertion error on `out.achieved[0].percentage` (got `0`, expected `100`). Existing tests should still pass.

- [ ] **Step 3: Add the `normalizePercentage()` helper and apply to current intake**

Open `bin/daily-slack-bucket.mjs`. After the `snapshotEntry` function (after its closing `}` on line 29), insert:

```js
function normalizePercentage(entry) {
  return entry.status_type === 'closed' ? 100 : entry.percentage;
}
```

Then in the `bucket()` function loop, immediately after the `clickup_id` validation block, **before** the `new_snapshot[t.clickup_id] = snapshotEntry(t);` line, add:

```js
    t.percentage = normalizePercentage(t);
```

Final shape of the loop top:
```js
  for (const t of current) {
    if (!t.clickup_id) {
      console.error(`error: task missing clickup_id: ${JSON.stringify(t)}`);
      process.exit(2);
    }
    t.percentage = normalizePercentage(t);
    new_snapshot[t.clickup_id] = snapshotEntry(t);
    const p = prior ? prior[t.clickup_id] : undefined;
    // ... unchanged
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
node --test tests/unit/daily-slack-bucket.test.mjs
```

Expected: all tests pass, including the new one.

- [ ] **Step 5: Commit**

```bash
git add bin/daily-slack-bucket.mjs tests/unit/daily-slack-bucket.test.mjs
git commit -m "feat(daily-slack-bucket): normalize closed tasks to 100% on current intake"
```

---

### Task 2: Add a failing test for legacy closed snapshot (no false-positive)

**Files:**
- Modify: `tests/unit/daily-slack-bucket.test.mjs` (add second test inside the `describe` block from Task 1)

- [ ] **Step 1: Append the second failing test**

Inside the `describe('daily-slack-bucket — closed → 100% normalization', ...)` block created in Task 1, after the first `test(...)` and before the closing `});`, add:

```js
  test('legacy closed snapshot at 0 does not produce false-positive achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'closed' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 0, status_type: 'closed' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 0);
    assert.equal(out.not_achieved.length, 1);
    assert.equal(out.new_snapshot.a.percentage, 100);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
node --test tests/unit/daily-slack-bucket.test.mjs
```

Expected: the new test fails. Reason: after Task 1, `current.percentage` is normalized to 100 but `prior.percentage` is still 0, so `advanced=true` and the task lands in `achieved` (not `not_achieved`).

- [ ] **Step 3: Apply `normalizePercentage()` to the prior snapshot in `main()`**

Open `bin/daily-slack-bucket.mjs`. In the `main()` function, find the block:

```js
  let prior = null;
  if (snapshot && existsSync(snapshot)) {
    prior = parseJsonOrDie(readOrDie(snapshot, '--snapshot'), '--snapshot');
  }
```

Replace it with:

```js
  let prior = null;
  if (snapshot && existsSync(snapshot)) {
    prior = parseJsonOrDie(readOrDie(snapshot, '--snapshot'), '--snapshot');
    for (const id of Object.keys(prior)) {
      prior[id].percentage = normalizePercentage(prior[id]);
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
node --test tests/unit/daily-slack-bucket.test.mjs
```

Expected: all tests pass, including both new ones.

- [ ] **Step 5: Commit**

```bash
git add bin/daily-slack-bucket.mjs tests/unit/daily-slack-bucket.test.mjs
git commit -m "feat(daily-slack-bucket): normalize closed entries on prior snapshot load"
```

---

### Task 3: Add the three remaining regression tests

**Files:**
- Modify: `tests/unit/daily-slack-bucket.test.mjs` (add three more tests in the same `describe` block)

- [ ] **Step 1: Append the three remaining tests**

Inside the `describe('daily-slack-bucket — closed → 100% normalization', ...)` block, after the second `test(...)` and before the closing `});`, add:

```js
  test('non-closed task at 0 is left untouched', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'open' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 0, status_type: 'open' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.not_achieved[0].percentage, 0);
    assert.equal(out.new_snapshot.a.percentage, 0);
  });

  test('new closed task (no prior entry) lands in achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'closed' }];
    const snap = {};
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
    assert.equal(out.achieved[0].percentage, 100);
  });

  test('first run with closed task still goes to not_achieved (rule unchanged)', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'closed' }];
    const r = run(setup(current, null));
    const out = JSON.parse(r.stdout);
    assert.equal(out.first_run, true);
    assert.equal(out.not_achieved.length, 1);
    assert.equal(out.not_achieved[0].percentage, 100);
  });
```

- [ ] **Step 2: Run the test suite to verify all tests pass**

Run:
```bash
node --test tests/unit/daily-slack-bucket.test.mjs
```

Expected: all tests pass — the existing 8 tests plus all 5 in the new `describe` block. No code changes are needed; these tests confirm the normalization invariant on additional paths.

- [ ] **Step 3: Run the full unit test suite as a smoke check**

Run:
```bash
node --test tests/unit/
```

Expected: every test in `tests/unit/` passes. No regressions in adjacent suites (render, scan-urls, extract-reason).

- [ ] **Step 4: Commit**

```bash
git add tests/unit/daily-slack-bucket.test.mjs
git commit -m "test(daily-slack-bucket): cover untouched, new-closed, and first-run paths"
```

---

### Task 4: Document the invariant in the workflow markdown

**Files:**
- Modify: `jelou/workflows/daily-slack.md:67-69`

- [ ] **Step 1: Append the invariant note at end of Step 6c**

Open `jelou/workflows/daily-slack.md`. Locate Step 6c (around lines 60-71). After line 69 (`- ClickUp-only tasks: \`(closed_subtasks / total_subtasks) × 90\`; no PR upgrade. If no subtasks, 0.`) and before line 71 (the `Build <workspace>/.cache/current-tasks.json:` instruction), insert a blank line followed by:

```markdown
Note: tasks with `status.type == closed` are normalized to `percentage: 100` downstream by `bin/daily-slack-bucket.mjs`, regardless of subtask count. The orchestrator's calculation here can be left as-is; the bucketer enforces the closed-as-done invariant.
```

The result around lines 67-72 should read:

```markdown
Calculate `percentage`:
- Plugin tasks: `(closed_subtasks / total_subtasks) × 90`. If exactly 90, run `gh pr view <url> --json state` for each PR URL; if all merged, upgrade to 100.
- ClickUp-only tasks: `(closed_subtasks / total_subtasks) × 90`; no PR upgrade. If no subtasks, 0.

Note: tasks with `status.type == closed` are normalized to `percentage: 100` downstream by `bin/daily-slack-bucket.mjs`, regardless of subtask count. The orchestrator's calculation here can be left as-is; the bucketer enforces the closed-as-done invariant.

Build `<workspace>/.cache/current-tasks.json`: an array of `{clickup_id, name, url, percentage, status_type, due_date, source, slug, pr_urls}`.
```

- [ ] **Step 2: Verify the file still parses as readable markdown**

Run:
```bash
head -75 jelou/workflows/daily-slack.md | tail -15
```

Expected: the note appears as a standalone paragraph between the bullet list and the `Build ...` instruction. No broken bullets, no duplicate headings.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/daily-slack.md
git commit -m "docs(daily-slack): document closed→100 normalization invariant in Step 6c"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by |
|--------------|------------|
| Decision: fix in bucketer | Tasks 1-3 |
| Invariant: no `status_type='closed'` with `percentage !== 100` | Tasks 1-3 (intake on current + prior + tests across all paths) |
| Change 1 — `normalizePercentage()` helper + two intake points | Task 1 (helper + current), Task 2 (prior) |
| Change 2 — 5 new tests in new `describe` block | Task 1 (test 1), Task 2 (test 2), Task 3 (tests 3-5) |
| Change 3 — note in `daily-slack.md` Step 6c | Task 4 |
| Edge cases 1-7 in spec table | Test 1: case 1; Test 2: case 2; Test 3: case 5; Test 4: case 6; Test 5: case 7. Cases 3 (closed `p:100`, prior `in_progress`) and 4 (closed `p:50`, prior `in_progress`) are subsumed by existing test `became closed → achieved` at line 76-82 of the test file plus Test 1's behavior |
| Out of scope items | Honored — no render, helpers-promotion, or orchestrator-formula changes |

All spec requirements have a corresponding task. No gaps.

**Placeholder scan:** No TBD/TODO/"add appropriate X" patterns. Every code-modifying step shows the exact code. Every command shows expected output.

**Type/name consistency:** `normalizePercentage` is referenced identically in Tasks 1 and 2. The describe block title `'daily-slack-bucket — closed → 100% normalization'` is the same string across all three task references. Test names match the spec's edge-case table verbatim.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-28-daily-slack-closed-percentage.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
