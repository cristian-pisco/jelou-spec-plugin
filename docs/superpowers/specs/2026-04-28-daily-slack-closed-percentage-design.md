# Treat closed tasks as 100% in daily-slack bucketer

## Problem

In `/jlu-daily-slack`, a sprint task with `status.type == closed` but **zero subtasks** ends up with `percentage: 0` in `current-tasks.json` because the orchestrator's formula in `jelou/workflows/daily-slack.md` Step 6c (`(closed_subtasks / total_subtasks) × 90`, "if no subtasks, 0") cannot produce 100 without subtasks.

Downstream consequences:

1. The rendered Slack message shows `0%` next to a closed task — visibly wrong, requires manual correction before posting.
2. The snapshot persisted to the published draft frontmatter records `{ percentage: 0, status_type: "closed" }`, which then becomes the `prior` for the next run.

The bucketer (`bin/daily-slack-bucket.mjs`) already handles the **transition** to closed correctly via `becameClosed` (line 51), so achievement bucketing is right. The bug is purely in the displayed and persisted percentage value.

## Decision: fix in the bucketer, not the workflow

The percentage calculation lives in two conceptual places:

- **`daily-slack.md` Step 6c** — LLM orchestrator-driven, runs at task discovery.
- **`daily-slack-bucket.mjs`** — deterministic Node script, runs after task discovery.

We normalize in the bucketer because it is deterministic, unit-testable, and acts as a guard even when the orchestrator's calculation is correct. The workflow markdown gets a short note pointing at the invariant so readers understand why a closed task always renders as 100%.

## Invariant

> After `bin/daily-slack-bucket.mjs` runs, no task or snapshot entry with `status_type === 'closed'` has `percentage !== 100`. This holds for `achieved`, `not_achieved`, and `new_snapshot`.

## Changes

### 1. `bin/daily-slack-bucket.mjs`

Add a module-local helper:

```js
function normalizePercentage(entry) {
  return entry.status_type === 'closed' ? 100 : entry.percentage;
}
```

Apply it at two intake points:

- Inside `bucket()`, at the top of the loop iteration, mutate `t.percentage = normalizePercentage(t)` **before** `snapshotEntry(t)` and the comparison.
- In `main()`, immediately after parsing the prior snapshot, walk its entries and mutate `prior[id].percentage = normalizePercentage(prior[id])`.

**Why also normalize the prior snapshot:** legacy published drafts may have `{ p: 0, status_type: "closed" }` for closed tasks recorded before this fix. Without normalizing the prior entry, the next run would compare `current.p=100` (newly normalized) against `prior.p=0` (legacy), see `advanced=true`, and produce a false-positive in `achieved`. Normalizing both sides makes the rule symmetric and removes any migration blip.

**Why module-local rather than `bin/lib/daily-slack-helpers.mjs`:** the rule only applies to the bucketer today. If render or another script needs it later, promote then.

**Why mutation in-place:** the existing code already shares object references between `current`, `achieved`, and `not_achieved`. Allocating new objects buys nothing and complicates the flow.

### 2. `tests/unit/daily-slack-bucket.test.mjs`

Add a new `describe` block with five tests:

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

  test('legacy closed snapshot at 0 does not produce false-positive achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 0, status_type: 'closed' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 0, status_type: 'closed' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 0);
    assert.equal(out.not_achieved.length, 1);
    assert.equal(out.new_snapshot.a.percentage, 100);
  });

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
});
```

Existing tests are untouched. `became closed → achieved` already covers the `closed` + `p=100` path explicitly.

### 3. `jelou/workflows/daily-slack.md`

At the end of Step 6c, append a short note after the two existing bullets:

> Note: tasks with `status.type == closed` are normalized to `percentage: 100` downstream by `bin/daily-slack-bucket.mjs`, regardless of subtask count. The orchestrator's calculation here can be left as-is; the bucketer enforces the closed-as-done invariant.

This documents the invariant for future readers without duplicating the rule in two places.

## Edge Cases

| # | Scenario | Input | After normalization | Bucket |
|---|----------|-------|---------------------|--------|
| 1 | Closed, no subtasks (the bug) | current `{p:0, closed}`, prior `{p:50, in_progress}` | current.p=100 | **achieved** (becameClosed) |
| 2 | Closed, legacy in snapshot | current `{p:0, closed}`, prior `{p:0, closed}` | both p=100 | **not_achieved** (no transition, no advance) |
| 3 | Closed, all subtasks done (idempotent) | current `{p:100, closed}`, prior `{p:90, in_progress}` | current.p=100 | **achieved** (becameClosed + advanced) |
| 4 | Closed manually mid-progress | current `{p:50, closed}`, prior `{p:50, in_progress}` | current.p=100 | **achieved** (becameClosed) |
| 5 | Non-closed at 0 (untouched) | current `{p:0, open}` | unchanged | **not_achieved** |
| 6 | New closed task (no prior entry) | current `{p:0, closed}`, no entry in prior | current.p=100 | **achieved** (`p===undefined && t.percentage > 0`) |
| 7 | First run with closed task | current `{p:0, closed}`, no snapshot | current.p=100, no prior | **not_achieved** (first_run rule) |

Case 7: first_run sends every task to `not_achieved` regardless. That existing behavior is intentional (first runs do not announce historical achievements) and is preserved.

## Files Modified

| File | Change |
|------|--------|
| `bin/daily-slack-bucket.mjs` | Add `normalizePercentage()` helper; apply to current at intake and to prior snapshot at load |
| `tests/unit/daily-slack-bucket.test.mjs` | Add `describe` block with 5 normalization tests |
| `jelou/workflows/daily-slack.md` | Append a one-line note at end of Step 6c documenting the invariant |

## Out of Scope

- The orchestrator's formula in Step 6c is left as-is — the bucketer is the guard.
- No changes to render, render-data, or `daily-slack-render.mjs` — they consume the already-normalized values.
- No promotion of `normalizePercentage` to `lib/daily-slack-helpers.mjs`. Defer until a second consumer needs it.
- No changes to existing tests; the existing `became closed → achieved` test continues to cover the explicit `p=100` case.
