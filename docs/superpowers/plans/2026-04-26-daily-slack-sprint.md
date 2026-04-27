# Daily Slack — Sprint-Scoped Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/jlu-post-slack` as sprint-scoped `/jlu-daily-slack <sprint> #channel` with delta-based bucketing, snapshot rollover, Spanish dailyBrain template, auto-extracted "why" reasons, and hard-guarded link safety.

**Architecture:** Workflow markdown (`jelou/workflows/daily-slack.md`) orchestrates the flow and delegates pure logic to four small Node bin scripts (URL scan, bucket/delta, reason extraction, placeholder render) — each unit-tested with `node --test`. The skill at `skills/daily-slack/SKILL.md` is the entry point. ClickUp MCP supplies task data; `gh` CLI supplies PR state; Slack MCP posts the result.

**Tech Stack:** Node 20+ ESM (`*.mjs`), `node --test`, ClickUp MCP, Slack MCP, `gh` CLI, markdown skill/workflow files, YAML frontmatter

**Spec:** `docs/superpowers/specs/2026-04-26-daily-slack-sprint-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Rename | `skills/post-slack/` → `skills/daily-slack/` | Skill entry point |
| Edit | `skills/daily-slack/SKILL.md` | Update name/description/argument-hint/allowed-tools |
| Rename | `jelou/workflows/post-slack.md` → `jelou/workflows/daily-slack.md` | Orchestration markdown |
| Rewrite | `jelou/workflows/daily-slack.md` | New sprint-scoped flow |
| Rename | `.opencode/commands/jlu-post-slack.md` → `.opencode/commands/jlu-daily-slack.md` | OpenCode placeholder |
| Edit | `jelou/templates/slack-channel.md` | New placeholders + Spanish dailyBrain example |
| Create | `bin/daily-slack-scan-urls.mjs` | URL safety scan helper |
| Create | `bin/daily-slack-bucket.mjs` | Delta computation + bucketing |
| Create | `bin/daily-slack-extract-reason.mjs` | "Why" reason priority extraction |
| Create | `bin/daily-slack-render.mjs` | Render automated placeholder strings |
| Create | `tests/unit/daily-slack-scan-urls.test.mjs` | Test |
| Create | `tests/unit/daily-slack-bucket.test.mjs` | Test |
| Create | `tests/unit/daily-slack-extract-reason.test.mjs` | Test |
| Create | `tests/unit/daily-slack-render.test.mjs` | Test |
| Edit | `README.md` | Reference new command name + sprint argument |
| Edit | `AGENTS.md` (if it references the old name) | Same |

No agent files are deleted — the current command already orchestrates inline.

---

### Task 1: Rename skill, workflow, and OpenCode command

**Files:**
- Rename: `skills/post-slack/` → `skills/daily-slack/`
- Rename: `jelou/workflows/post-slack.md` → `jelou/workflows/daily-slack.md`
- Rename: `.opencode/commands/jlu-post-slack.md` → `.opencode/commands/jlu-daily-slack.md`
- Modify: `skills/daily-slack/SKILL.md`

- [ ] **Step 1: Rename the skill directory**

```bash
git mv skills/post-slack skills/daily-slack
```

- [ ] **Step 2: Rename the workflow file**

```bash
git mv jelou/workflows/post-slack.md jelou/workflows/daily-slack.md
```

- [ ] **Step 3: Rename the OpenCode command**

```bash
git mv .opencode/commands/jlu-post-slack.md .opencode/commands/jlu-daily-slack.md
```

- [ ] **Step 4: Update `skills/daily-slack/SKILL.md` frontmatter**

Replace the entire frontmatter block in `skills/daily-slack/SKILL.md` and the workflow path reference. Keep the body otherwise; the full rewrite of the workflow happens in Task 9.

```markdown
---
name: daily-slack
description: Use to share sprint progress on Slack — generates and posts a sprint-scoped daily summary to a channel. Triggers: "post to Slack", "daily update", "share sprint progress", "Slack daily"
argument-hint: "<sprint> #channel"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - ToolSearch
---
```

Then in the body of `SKILL.md`, change the workflow filename reference:

```
Read the workflow file at `<plugin-root>/jelou/workflows/daily-slack.md`.
```

- [ ] **Step 5: Verify no stray references to the old name**

```bash
grep -r "post-slack\|jlu-post-slack" --include="*.md" --include="*.json" --include="*.mjs" . | grep -v "docs/superpowers" | grep -v "node_modules"
```

Expected: only matches in `CHANGELOG.md` history, `docs/superpowers/specs/2026-03-19-...`, `docs/superpowers/plans/2026-03-19-...`. No active skill, workflow, command, or README references.

- [ ] **Step 6: Commit**

```bash
git add skills/daily-slack jelou/workflows/daily-slack.md .opencode/commands/jlu-daily-slack.md
git commit -m "refactor(daily-slack): rename post-slack to daily-slack"
```

---

### Task 2: TDD `bin/daily-slack-scan-urls.mjs` (URL safety)

**Files:**
- Create: `tests/unit/daily-slack-scan-urls.test.mjs`
- Create: `bin/daily-slack-scan-urls.mjs`

The script reads a body file and an allowlist file (one URL per line) and exits 0 if every `app.clickup.com` URL in the body is in the allowlist; exits 1 otherwise, printing the first violating URL to stderr.

- [ ] **Step 1: Write the red test (happy path + violation)**

Write `tests/unit/daily-slack-scan-urls.test.mjs`:

```javascript
// tests/unit/daily-slack-scan-urls.test.mjs
//
// Run: `node --test tests/unit/daily-slack-scan-urls.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../bin/daily-slack-scan-urls.mjs', import.meta.url).pathname;

function setup(body, allowlist) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-scan-'));
  const bodyPath = join(dir, 'body.md');
  const allowPath = join(dir, 'allow.txt');
  writeFileSync(bodyPath, body);
  writeFileSync(allowPath, allowlist.join('\n') + '\n');
  return { bodyPath, allowPath };
}

function run({ bodyPath, allowPath }) {
  return spawnSync('node', [SCRIPT, '--body', bodyPath, '--allowlist', allowPath], { encoding: 'utf8' });
}

describe('daily-slack-scan-urls — happy path', () => {
  test('exits 0 when every clickup URL is in the allowlist', () => {
    const body = '[90%] Task A\nhttps://app.clickup.com/t/abc123\n\n[100%] Task B\nhttps://app.clickup.com/t/def456';
    const allow = ['https://app.clickup.com/t/abc123', 'https://app.clickup.com/t/def456'];
    const r = run(setup(body, allow));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  test('exits 0 when body has no clickup URLs', () => {
    const body = 'Plain text with no links.';
    const r = run(setup(body, []));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });
});

describe('daily-slack-scan-urls — violation', () => {
  test('exits 1 and prints the unknown URL when one is not in allowlist', () => {
    const body = 'Look at https://app.clickup.com/t/UNKNOWN here.';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123']));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown clickup url: https:\/\/app\.clickup\.com\/t\/UNKNOWN/);
  });
});
```

- [ ] **Step 2: Run the test — expect failure (script does not exist)**

```bash
node --test tests/unit/daily-slack-scan-urls.test.mjs
```

Expected: all tests fail with "Cannot find module" or non-zero exit because `bin/daily-slack-scan-urls.mjs` does not exist yet.

- [ ] **Step 3: Implement the minimal script**

Write `bin/daily-slack-scan-urls.mjs`:

```javascript
#!/usr/bin/env node
// bin/daily-slack-scan-urls.mjs
//
// Scans a body file for app.clickup.com URLs and verifies every match is
// present in the allowlist file (one URL per line). Exits 0 on success;
// exits 1 and prints the first unknown URL to stderr on failure.
//
// Usage:
//   node bin/daily-slack-scan-urls.mjs --body <path> --allowlist <path>

import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--body') args.body = argv[++i];
    else if (argv[i] === '--allowlist') args.allowlist = argv[++i];
  }
  if (!args.body || !args.allowlist) {
    console.error('error: --body <path> and --allowlist <path> are required');
    process.exit(2);
  }
  return args;
}

const URL_RE = /https?:\/\/app\.clickup\.com\/t\/[^\s)]+/g;

function normalize(url) {
  return url.replace(/[.,);\]}]+$/, '').replace(/\?.*$/, '');
}

function main() {
  const { body, allowlist } = parseArgs(process.argv);
  const text = readFileSync(body, 'utf8');
  const allowed = new Set(
    readFileSync(allowlist, 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalize)
  );
  const matches = text.match(URL_RE) || [];
  for (const raw of matches) {
    const url = normalize(raw);
    if (!allowed.has(url)) {
      console.error(`unknown clickup url: ${url}`);
      process.exit(1);
    }
  }
  process.exit(0);
}

main();
```

- [ ] **Step 4: Run the test — expect pass**

```bash
node --test tests/unit/daily-slack-scan-urls.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add bin/daily-slack-scan-urls.mjs tests/unit/daily-slack-scan-urls.test.mjs
git commit -m "feat(daily-slack-scan-urls): green — verify clickup URLs against allowlist"
```

- [ ] **Step 6: Add red tests for normalization edge cases**

Append the following describe block to `tests/unit/daily-slack-scan-urls.test.mjs`:

```javascript
describe('daily-slack-scan-urls — normalization', () => {
  test('strips trailing punctuation before allowlist check', () => {
    const body = 'See https://app.clickup.com/t/abc123).';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123']));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  test('strips query string before allowlist check', () => {
    const body = 'See https://app.clickup.com/t/abc123?ref=email';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123']));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  test('catches URL among many valid ones', () => {
    const body = 'A https://app.clickup.com/t/abc123 B https://app.clickup.com/t/EVIL C https://app.clickup.com/t/def456';
    const r = run(setup(body, ['https://app.clickup.com/t/abc123', 'https://app.clickup.com/t/def456']));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown clickup url: https:\/\/app\.clickup\.com\/t\/EVIL/);
  });
});
```

- [ ] **Step 7: Run — expect new tests pass (already implemented in Step 3)**

```bash
node --test tests/unit/daily-slack-scan-urls.test.mjs
```

Expected: all tests pass (the script's normalization already handles these cases).

- [ ] **Step 8: Commit**

```bash
git add tests/unit/daily-slack-scan-urls.test.mjs
git commit -m "test(daily-slack-scan-urls): cover normalization edge cases"
```

---

### Task 3: TDD `bin/daily-slack-bucket.mjs` (delta + bucketing)

**Files:**
- Create: `tests/unit/daily-slack-bucket.test.mjs`
- Create: `bin/daily-slack-bucket.mjs`

The script reads two JSON files: `current.json` (array of `{clickup_id, name, url, percentage, status_type, due_date}`) and `snapshot.json` (object keyed by `clickup_id` with `{name, url, percentage, status_type}`). The snapshot file is optional — missing means first run. It outputs JSON with `{achieved, not_achieved, new_snapshot, first_run}` to stdout.

- [ ] **Step 1: Write the red test for first-run case**

Write `tests/unit/daily-slack-bucket.test.mjs`:

```javascript
// tests/unit/daily-slack-bucket.test.mjs
//
// Run: `node --test tests/unit/daily-slack-bucket.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../bin/daily-slack-bucket.mjs', import.meta.url).pathname;

function setup(current, snapshot) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-bucket-'));
  const currentPath = join(dir, 'current.json');
  writeFileSync(currentPath, JSON.stringify(current));
  let snapshotPath = '';
  if (snapshot !== null) {
    snapshotPath = join(dir, 'snapshot.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot));
  }
  return { currentPath, snapshotPath };
}

function run({ currentPath, snapshotPath }) {
  const args = [SCRIPT, '--current', currentPath];
  if (snapshotPath) args.push('--snapshot', snapshotPath);
  return spawnSync('node', args, { encoding: 'utf8' });
}

describe('daily-slack-bucket — first run', () => {
  test('all tasks go to not_achieved when no snapshot file', () => {
    const current = [
      { clickup_id: 'a', name: 'A', url: 'https://app.clickup.com/t/a', percentage: 30, status_type: 'in_progress' },
      { clickup_id: 'b', name: 'B', url: 'https://app.clickup.com/t/b', percentage: 0, status_type: 'open' },
    ];
    const r = run(setup(current, null));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.first_run, true);
    assert.equal(out.achieved.length, 0);
    assert.equal(out.not_achieved.length, 2);
    assert.deepEqual(out.new_snapshot.a, { name: 'A', url: 'https://app.clickup.com/t/a', percentage: 30, status_type: 'in_progress' });
  });
});
```

- [ ] **Step 2: Run — expect failure (no script)**

```bash
node --test tests/unit/daily-slack-bucket.test.mjs
```

Expected: failure.

- [ ] **Step 3: Implement minimal script**

Write `bin/daily-slack-bucket.mjs`:

```javascript
#!/usr/bin/env node
// bin/daily-slack-bucket.mjs
//
// Reads current task data and an optional prior snapshot, computes
// achieved/not-achieved buckets, and prints the result + new snapshot
// as JSON to stdout.
//
// Usage:
//   node bin/daily-slack-bucket.mjs --current <path> [--snapshot <path>]

import { existsSync, readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--current') args.current = argv[++i];
    else if (argv[i] === '--snapshot') args.snapshot = argv[++i];
  }
  if (!args.current) {
    console.error('error: --current <path> is required');
    process.exit(2);
  }
  return args;
}

function snapshotEntry(t) {
  return { name: t.name, url: t.url, percentage: t.percentage, status_type: t.status_type };
}

function bucket(current, prior) {
  const achieved = [];
  const not_achieved = [];
  const new_snapshot = {};
  for (const t of current) {
    new_snapshot[t.clickup_id] = snapshotEntry(t);
    const p = prior ? prior[t.clickup_id] : undefined;
    if (!prior) {
      not_achieved.push(t);
      continue;
    }
    if (p === undefined) {
      if (t.percentage > 0) achieved.push(t);
      else not_achieved.push(t);
      continue;
    }
    const becameClosed = p.status_type !== 'closed' && t.status_type === 'closed';
    const advanced = t.percentage > p.percentage;
    if (becameClosed || advanced) achieved.push(t);
    else not_achieved.push(t);
  }
  return { achieved, not_achieved, new_snapshot, first_run: !prior };
}

function main() {
  const { current, snapshot } = parseArgs(process.argv);
  const cur = JSON.parse(readFileSync(current, 'utf8'));
  let prior = null;
  if (snapshot && existsSync(snapshot)) {
    prior = JSON.parse(readFileSync(snapshot, 'utf8'));
  }
  process.stdout.write(JSON.stringify(bucket(cur, prior)) + '\n');
}

main();
```

- [ ] **Step 4: Run — expect pass**

```bash
node --test tests/unit/daily-slack-bucket.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add bin/daily-slack-bucket.mjs tests/unit/daily-slack-bucket.test.mjs
git commit -m "feat(daily-slack-bucket): green — first-run bucketing"
```

- [ ] **Step 6: Add red tests for delta cases**

Append to `tests/unit/daily-slack-bucket.test.mjs`:

```javascript
describe('daily-slack-bucket — delta', () => {
  test('percentage rose → achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 60, status_type: 'in_progress' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 30, status_type: 'in_progress' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
    assert.equal(out.not_achieved.length, 0);
    assert.equal(out.first_run, false);
  });

  test('percentage unchanged → not_achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 30, status_type: 'in_progress' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 30, status_type: 'in_progress' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.not_achieved.length, 1);
    assert.equal(out.achieved.length, 0);
  });

  test('regression → not_achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 20, status_type: 'in_progress' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 30, status_type: 'in_progress' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.not_achieved.length, 1);
  });

  test('became closed → achieved', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 100, status_type: 'closed' }];
    const snap = { a: { name: 'A', url: 'u', percentage: 100, status_type: 'in_progress' } };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
  });

  test('new task at >0% → achieved (added since snapshot)', () => {
    const current = [{ clickup_id: 'b', name: 'B', url: 'u', percentage: 50, status_type: 'in_progress' }];
    const snap = {};
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length, 1);
  });

  test('new task at 0% → not_achieved', () => {
    const current = [{ clickup_id: 'b', name: 'B', url: 'u', percentage: 0, status_type: 'open' }];
    const snap = {};
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.not_achieved.length, 1);
  });

  test('task in snapshot but not current → dropped (not in either bucket)', () => {
    const current = [{ clickup_id: 'a', name: 'A', url: 'u', percentage: 100, status_type: 'closed' }];
    const snap = {
      a: { name: 'A', url: 'u', percentage: 50, status_type: 'in_progress' },
      gone: { name: 'Gone', url: 'u2', percentage: 50, status_type: 'in_progress' },
    };
    const r = run(setup(current, snap));
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved.length + out.not_achieved.length, 1);
    assert.ok(!out.new_snapshot.gone);
  });
});
```

- [ ] **Step 7: Run — expect pass (logic already covers these cases)**

```bash
node --test tests/unit/daily-slack-bucket.test.mjs
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add tests/unit/daily-slack-bucket.test.mjs
git commit -m "test(daily-slack-bucket): cover delta, regression, drop, and new-task cases"
```

---

### Task 4: TDD `bin/daily-slack-extract-reason.mjs` ("why" reason priority)

**Files:**
- Create: `tests/unit/daily-slack-extract-reason.test.mjs`
- Create: `bin/daily-slack-extract-reason.mjs`

Reads a single JSON file describing one task: `{cutoff: ISO|null, comments: [{date_iso, text}], pr_states: {url: {state, isDraft, mergeable, checks}}}`. Outputs the chosen reason as a single line to stdout.

Priority:
1. Latest comment with `date_iso > cutoff` (truncated to 200 chars).
2. PR state Spanish canned: `aún en borrador` (any draft) > `con conflictos de merge` (any mergeable=false) > `CI fallando` (any state=open with checks=failing) > `esperando revisión` (any state=open).
3. Most recent comment overall (truncated to 200 chars).
4. Fallback: `sin actualizaciones recientes — agregar razón manual`.

- [ ] **Step 1: Write the red test (priority 1: post-cutoff comment wins)**

Write `tests/unit/daily-slack-extract-reason.test.mjs`:

```javascript
// tests/unit/daily-slack-extract-reason.test.mjs
//
// Run: `node --test tests/unit/daily-slack-extract-reason.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../bin/daily-slack-extract-reason.mjs', import.meta.url).pathname;

function setup(task) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-reason-'));
  const taskPath = join(dir, 'task.json');
  writeFileSync(taskPath, JSON.stringify(task));
  return taskPath;
}

function run(taskPath) {
  return spawnSync('node', [SCRIPT, '--task', taskPath], { encoding: 'utf8' });
}

describe('daily-slack-extract-reason — priority 1', () => {
  test('post-cutoff comment wins over PR state and old comment', () => {
    const taskPath = setup({
      cutoff: '2026-04-25T08:00:00Z',
      comments: [
        { date_iso: '2026-04-26T07:30:00Z', text: 'Esperando feedback del PM.' },
        { date_iso: '2026-04-20T08:00:00Z', text: 'old comment' },
      ],
      pr_states: { 'https://gh/x/y/pull/1': { state: 'OPEN', isDraft: true, mergeable: true } },
    });
    const r = run(taskPath);
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'Esperando feedback del PM.');
  });

  test('truncates long comment to 200 chars', () => {
    const long = 'x'.repeat(250);
    const taskPath = setup({
      cutoff: '2026-04-25T08:00:00Z',
      comments: [{ date_iso: '2026-04-26T07:30:00Z', text: long }],
      pr_states: {},
    });
    const r = run(taskPath);
    assert.equal(r.stdout.trim().length, 200);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
node --test tests/unit/daily-slack-extract-reason.test.mjs
```

Expected: failure (no script).

- [ ] **Step 3: Implement minimal script**

Write `bin/daily-slack-extract-reason.mjs`:

```javascript
#!/usr/bin/env node
// bin/daily-slack-extract-reason.mjs
//
// Reads a task JSON file and prints the priority-resolved "why" reason.
//
// Usage:
//   node bin/daily-slack-extract-reason.mjs --task <path>

import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--task') args.task = argv[++i];
  }
  if (!args.task) {
    console.error('error: --task <path> is required');
    process.exit(2);
  }
  return args;
}

const FALLBACK = 'sin actualizaciones recientes — agregar razón manual';

function truncate(s) {
  return s.length > 200 ? s.slice(0, 200) : s;
}

function postCutoffComment(comments, cutoff) {
  if (!cutoff) return null;
  const after = comments
    .filter((c) => c.date_iso > cutoff)
    .sort((a, b) => (a.date_iso < b.date_iso ? 1 : -1));
  return after.length ? truncate(after[0].text) : null;
}

function prStateReason(pr_states) {
  const values = Object.values(pr_states || {});
  if (values.some((p) => p.isDraft)) return 'aún en borrador';
  if (values.some((p) => p.mergeable === false)) return 'con conflictos de merge';
  if (values.some((p) => p.state === 'OPEN' && p.checks === 'failing')) return 'CI fallando';
  if (values.some((p) => p.state === 'OPEN')) return 'esperando revisión';
  return null;
}

function mostRecentComment(comments) {
  if (!comments || comments.length === 0) return null;
  const sorted = [...comments].sort((a, b) => (a.date_iso < b.date_iso ? 1 : -1));
  return truncate(sorted[0].text);
}

function main() {
  const { task } = parseArgs(process.argv);
  const t = JSON.parse(readFileSync(task, 'utf8'));
  const reason =
    postCutoffComment(t.comments || [], t.cutoff) ||
    prStateReason(t.pr_states) ||
    mostRecentComment(t.comments || []) ||
    FALLBACK;
  process.stdout.write(reason + '\n');
}

main();
```

- [ ] **Step 4: Run — expect pass**

```bash
node --test tests/unit/daily-slack-extract-reason.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add bin/daily-slack-extract-reason.mjs tests/unit/daily-slack-extract-reason.test.mjs
git commit -m "feat(daily-slack-extract-reason): green — priority-1 post-cutoff comment"
```

- [ ] **Step 6: Add red tests for priorities 2, 3, 4**

Append to `tests/unit/daily-slack-extract-reason.test.mjs`:

```javascript
describe('daily-slack-extract-reason — priority 2 (PR state)', () => {
  test('falls to PR state when no post-cutoff comment', () => {
    const taskPath = setup({
      cutoff: '2026-04-25T08:00:00Z',
      comments: [],
      pr_states: { 'pr1': { state: 'OPEN', isDraft: true, mergeable: true } },
    });
    const r = run(taskPath);
    assert.equal(r.stdout.trim(), 'aún en borrador');
  });

  test('merge conflicts beats CI failing', () => {
    const taskPath = setup({
      cutoff: '2026-04-25T08:00:00Z',
      comments: [],
      pr_states: {
        'pr1': { state: 'OPEN', isDraft: false, mergeable: false },
        'pr2': { state: 'OPEN', isDraft: false, mergeable: true, checks: 'failing' },
      },
    });
    const r = run(taskPath);
    assert.equal(r.stdout.trim(), 'con conflictos de merge');
  });

  test('CI failing beats plain awaiting review', () => {
    const taskPath = setup({
      cutoff: '2026-04-25T08:00:00Z',
      comments: [],
      pr_states: { 'pr1': { state: 'OPEN', isDraft: false, mergeable: true, checks: 'failing' } },
    });
    const r = run(taskPath);
    assert.equal(r.stdout.trim(), 'CI fallando');
  });

  test('plain open PR → esperando revisión', () => {
    const taskPath = setup({
      cutoff: '2026-04-25T08:00:00Z',
      comments: [],
      pr_states: { 'pr1': { state: 'OPEN', isDraft: false, mergeable: true } },
    });
    const r = run(taskPath);
    assert.equal(r.stdout.trim(), 'esperando revisión');
  });
});

describe('daily-slack-extract-reason — priority 3 (older comment)', () => {
  test('falls to most recent comment when no PR state', () => {
    const taskPath = setup({
      cutoff: '2026-04-25T08:00:00Z',
      comments: [{ date_iso: '2026-04-20T08:00:00Z', text: 'Bloqueado por dependencia X.' }],
      pr_states: {},
    });
    const r = run(taskPath);
    assert.equal(r.stdout.trim(), 'Bloqueado por dependencia X.');
  });
});

describe('daily-slack-extract-reason — priority 4 (fallback)', () => {
  test('uses Spanish fallback when no comments and no PRs', () => {
    const taskPath = setup({ cutoff: '2026-04-25T08:00:00Z', comments: [], pr_states: {} });
    const r = run(taskPath);
    assert.equal(r.stdout.trim(), 'sin actualizaciones recientes — agregar razón manual');
  });

  test('uses fallback when cutoff is null and there are no comments', () => {
    const taskPath = setup({ cutoff: null, comments: [], pr_states: {} });
    const r = run(taskPath);
    assert.equal(r.stdout.trim(), 'sin actualizaciones recientes — agregar razón manual');
  });
});
```

- [ ] **Step 7: Run — expect pass**

```bash
node --test tests/unit/daily-slack-extract-reason.test.mjs
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add tests/unit/daily-slack-extract-reason.test.mjs
git commit -m "test(daily-slack-extract-reason): cover PR-state priority and fallback"
```

---

### Task 5: TDD `bin/daily-slack-render.mjs` (placeholder rendering)

**Files:**
- Create: `tests/unit/daily-slack-render.test.mjs`
- Create: `bin/daily-slack-render.mjs`

Reads JSON from a file: `{first_run: bool, achieved: [...], not_achieved: [...], short_term: [...]}`. Each entry has `name`, `url`, plus `percentage` (achieved), `reason` (not_achieved), or `due_date` ISO string (short_term, optional). Outputs JSON to stdout: `{achieved_goals, not_achieved_goals, short_term_goals}`.

- [ ] **Step 1: Write the red test (happy path with content in each bucket)**

Write `tests/unit/daily-slack-render.test.mjs`:

```javascript
// tests/unit/daily-slack-render.test.mjs
//
// Run: `node --test tests/unit/daily-slack-render.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../bin/daily-slack-render.mjs', import.meta.url).pathname;

function setup(data) {
  const dir = mkdtempSync(join(tmpdir(), 'daily-slack-render-'));
  const dataPath = join(dir, 'data.json');
  writeFileSync(dataPath, JSON.stringify(data));
  return dataPath;
}

function run(dataPath) {
  return spawnSync('node', [SCRIPT, '--data', dataPath], { encoding: 'utf8' });
}

describe('daily-slack-render — happy path', () => {
  test('renders all three placeholders with content', () => {
    const data = {
      first_run: false,
      achieved: [{ name: 'API node', url: 'https://app.clickup.com/t/abc', percentage: 90 }],
      not_achieved: [{ name: 'Migration', url: 'https://app.clickup.com/t/def', reason: 'esperando revisión' }],
      short_term: [{ name: 'API node', url: 'https://app.clickup.com/t/abc', due_date: '2026-04-30T00:00:00Z' }],
    };
    const r = run(setup(data));
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.achieved_goals, '[90%] API node\nhttps://app.clickup.com/t/abc');
    assert.equal(out.not_achieved_goals, 'Migration — esperando revisión\nhttps://app.clickup.com/t/def');
    assert.equal(out.short_term_goals, '[2026-04-30] API node https://app.clickup.com/t/abc');
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
node --test tests/unit/daily-slack-render.test.mjs
```

Expected: failure (no script).

- [ ] **Step 3: Implement minimal script**

Write `bin/daily-slack-render.mjs`:

```javascript
#!/usr/bin/env node
// bin/daily-slack-render.mjs
//
// Renders the three automated placeholders for the daily Slack report from
// a JSON input file. Outputs {achieved_goals, not_achieved_goals,
// short_term_goals} as JSON on stdout.
//
// Usage:
//   node bin/daily-slack-render.mjs --data <path>

import { readFileSync } from 'node:fs';

const FIRST_RUN_BANNER = '_Primer reporte del sprint — sin línea base para comparar._';
const ACHIEVED_EMPTY = '_Sin avances desde la última actualización._';
const NOT_ACHIEVED_EMPTY = '_Todas las tareas avanzaron._';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--data') args.data = argv[++i];
  }
  if (!args.data) {
    console.error('error: --data <path> is required');
    process.exit(2);
  }
  return args;
}

function renderAchieved(achieved, firstRun) {
  if (firstRun) return FIRST_RUN_BANNER;
  if (!achieved.length) return ACHIEVED_EMPTY;
  return achieved.map((t) => `[${t.percentage}%] ${t.name}\n${t.url}`).join('\n\n');
}

function renderNotAchieved(not_achieved) {
  if (!not_achieved.length) return NOT_ACHIEVED_EMPTY;
  return not_achieved.map((t) => `${t.name} — ${t.reason}\n${t.url}`).join('\n\n');
}

function isoDate(s) {
  return s.slice(0, 10);
}

function renderShortTerm(short_term) {
  const withDates = short_term.filter((t) => t.due_date);
  withDates.sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  return withDates.map((t) => `[${isoDate(t.due_date)}] ${t.name} ${t.url}`).join('\n');
}

function main() {
  const { data } = parseArgs(process.argv);
  const d = JSON.parse(readFileSync(data, 'utf8'));
  const out = {
    achieved_goals: renderAchieved(d.achieved || [], !!d.first_run),
    not_achieved_goals: renderNotAchieved(d.not_achieved || []),
    short_term_goals: renderShortTerm(d.short_term || []),
  };
  process.stdout.write(JSON.stringify(out) + '\n');
}

main();
```

- [ ] **Step 4: Run — expect pass**

```bash
node --test tests/unit/daily-slack-render.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add bin/daily-slack-render.mjs tests/unit/daily-slack-render.test.mjs
git commit -m "feat(daily-slack-render): green — render automated placeholders"
```

- [ ] **Step 6: Add red tests for empty states, first-run, sorting, missing dates**

Append to `tests/unit/daily-slack-render.test.mjs`:

```javascript
describe('daily-slack-render — empty + first-run', () => {
  test('first-run banner replaces achieved_goals when first_run is true', () => {
    const data = { first_run: true, achieved: [], not_achieved: [], short_term: [] };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.achieved_goals, '_Primer reporte del sprint — sin línea base para comparar._');
  });

  test('achieved_goals empty string when not first run and no achievements', () => {
    const data = { first_run: false, achieved: [], not_achieved: [], short_term: [] };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.achieved_goals, '_Sin avances desde la última actualización._');
  });

  test('not_achieved_goals empty string when all advanced', () => {
    const data = { first_run: false, achieved: [], not_achieved: [], short_term: [] };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.not_achieved_goals, '_Todas las tareas avanzaron._');
  });
});

describe('daily-slack-render — short_term sorting + filtering', () => {
  test('sorts ascending by due_date and omits tasks without due_date', () => {
    const data = {
      first_run: false,
      achieved: [],
      not_achieved: [],
      short_term: [
        { name: 'Late', url: 'u3', due_date: '2026-05-10T00:00:00Z' },
        { name: 'No date', url: 'u2' },
        { name: 'Early', url: 'u1', due_date: '2026-04-30T00:00:00Z' },
      ],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(
      out.short_term_goals,
      '[2026-04-30] Early u1\n[2026-05-10] Late u3'
    );
  });

  test('empty short_term renders empty string', () => {
    const data = { first_run: false, achieved: [], not_achieved: [], short_term: [] };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.short_term_goals, '');
  });
});

describe('daily-slack-render — multi-task spacing', () => {
  test('separates multiple achieved blocks with blank line', () => {
    const data = {
      first_run: false,
      achieved: [
        { name: 'A', url: 'u1', percentage: 50 },
        { name: 'B', url: 'u2', percentage: 100 },
      ],
      not_achieved: [],
      short_term: [],
    };
    const out = JSON.parse(run(setup(data)).stdout);
    assert.equal(out.achieved_goals, '[50%] A\nu1\n\n[100%] B\nu2');
  });
});
```

- [ ] **Step 7: Run — expect pass**

```bash
node --test tests/unit/daily-slack-render.test.mjs
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add tests/unit/daily-slack-render.test.mjs
git commit -m "test(daily-slack-render): cover empty/first-run/sorting/multi-task"
```

---

### Task 6: Update `jelou/templates/slack-channel.md`

**Files:**
- Modify: `jelou/templates/slack-channel.md`

- [ ] **Step 1: Rewrite the meta-template doc**

Replace the entire contents of `jelou/templates/slack-channel.md`:

```markdown
# Slack Channel Template

This is the meta-template for creating channel-specific Slack message templates.
Copy this file to `<workspace>/registry/slack/<channel-name>.md` and customize.

## Template Format

The file has two parts:

1. **YAML frontmatter** — defines channel name, manual fields, and their prompts
2. **Body** — the message structure with `{{placeholder}}` syntax

The published draft also stores `task_snapshots` in its frontmatter; that field
is managed automatically by the workflow — do not edit it by hand.

## Placeholders

### Automated (filled from sprint task data)
- `{{achieved_goals}}` — tasks whose percentage rose since the last published draft. Format per task: `[<%>] <name>\n<url>`
- `{{not_achieved_goals}}` — tasks whose percentage did not advance. Format per task: `<name> — <auto-extracted reason>\n<url>`
- `{{short_term_goals}}` — sprint tasks with a due date. Format: `[<YYYY-MM-DD>] <name> <url>`

On the very first run for a channel (no prior published draft), `{{achieved_goals}}`
renders the first-run banner instead of an empty string.

### Manual (user is prompted)
- Any placeholder listed in `manual_fields` triggers an interactive prompt via `question`
- The prompt text comes from `manual_prompts`
- User responses are inserted as-is with no formatting

## Example: dailies (Spanish dailyBrain)

```yaml
---
channel: "#dailies"
manual_fields:
  - energy
  - meetings
  - planned_achievements
manual_prompts:
  energy: "How's your energy today? (red / yellow / green emoji)"
  meetings: "Any meetings to mention? (e.g., Daily, 1:1, planning)"
  planned_achievements: "What do you plan to achieve before the next daily?"
---
```

```
#dailyBrain
¿Cómo está tu energía hoy? :large_red_square::large_yellow_square::large_green_square:
{{energy}}

¿Qué objetivos has logrado desde tu última actualización?

{{achieved_goals}}

Reuniones

{{meetings}}

¿Qué objetivos no has logrado desde tu última actualización? ¿Y por qué?

{{not_achieved_goals}}

¿Qué logros importantes tienes planeados para hoy y para la próxima actualización diaria?

{{planned_achievements}}

¿Cuáles son tus metas a corto plazo (y ETA)?

{{short_term_goals}}
```
```

- [ ] **Step 2: Commit**

```bash
git add jelou/templates/slack-channel.md
git commit -m "docs(slack-channel-template): document new placeholders + Spanish dailyBrain example"
```

---

### Task 7: Rewrite `jelou/workflows/daily-slack.md`

**Files:**
- Modify: `jelou/workflows/daily-slack.md`

This is the orchestration markdown that the LLM follows. It calls the four bin scripts created in Tasks 2–5 via Bash, calls ClickUp/Slack MCP, and uses `question` for prompts.

- [ ] **Step 1: Replace the workflow with the sprint-scoped flow**

Overwrite `jelou/workflows/daily-slack.md` with:

```markdown
# Workflow: daily-slack

> Orchestrator workflow for `/jlu-daily-slack <sprint> #channel`
> Generate and post a sprint-scoped daily summary to Slack.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

---

You are the orchestrator for the `/jlu-daily-slack` command. You generate a Slack message from sprint task data and a channel template, then post it after user approval.

## Step 1 — Parse Arguments

1. Parse `<sprint> #channel` from arguments.
2. Sprint is required. If missing, ask via `question`: "Which sprint number should I report on?"
3. Channel is required and must start with `#`. If missing, ask: "Which channel should I post to? (e.g., #dailies)"
4. Strip the `#` prefix for file lookups (e.g., `#dailies` → `dailies`).

## Step 2 — Resolve Workspace

1. Search for `.spec-workspace.json` in cwd and up to 5 parent directories.
2. Read the file and extract the `workspace` field. Resolve to an absolute path.
3. If not found, stop with: "No workspace found. Run /jlu-new-task first to initialize one."

## Step 3 — Load Channel Template

1. Read `<workspace>/registry/slack/<channel>.md`.
2. Parse YAML frontmatter for `manual_fields` and `manual_prompts`. Parse the body as the message template.
3. If missing, stop with: "No template found for #<channel>. Create one at `<workspace>/registry/slack/<channel>.md`. See `jelou/templates/slack-channel.md` for the format."

## Step 4 — Resolve User Identity

1. Read `<workspace>/registry/clickup-user.json`. If it exists with a non-empty `user_id`, skip to Step 5.
2. Otherwise, ask via `question`: "What's your ClickUp email?". Do NOT pre-fill, do NOT default. Do NOT use any value from prior conversations, memory, or environment.
3. Call `clickup_get_workspace_members` and case-insensitively match the email.
4. If zero matches, stop with: "No ClickUp member found for `<email>`. Check the address and try again."
5. Write `<workspace>/registry/clickup-user.json`:
   ```json
   { "email": "<email>", "user_id": "<id>", "username": "<name>" }
   ```

## Step 5 — Verify ClickUp MCP

Call `clickup_get_workspace_hierarchy` as a connectivity probe. On any failure, stop with the same message used by `/jlu-sync-clickup` Step 0.

## Step 6 — Discover Sprint Tasks

### 6a. Plugin tasks (sprint-filtered, ownership trusted)
Walk `<workspace>/specs/*/CLICKUP_TASK.json`. Include a task if `sprint == <sprint-arg>` (string comparison). Ownership is trusted: plugin tasks in a sprint folder were created by you via `/jlu-new-task`, so they're inherently yours.

For each included task, record `clickup_id` (= `macroTask.id`), `source: "plugin"`, `slug` (folder name), `clickup_url` (= `macroTask.url`), and `pr_urls` (= values of the `pr` map).

### 6b. ClickUp gap-fill
Query ClickUp for tasks where the `Sprint` custom field == `<sprint-arg>` AND (assignees contains user_id from Step 4 OR `Responsable` custom field == user_id).

If zero matches, retry with `Sprint <sprint-arg>` as the custom-field value.

For each ClickUp task whose `id` is not already in the plugin set, add an entry with `source: "clickup-only"`, `slug: null`, `pr_urls: []`.

### 6c. Per-task data fetch
For every task in the union, call `clickup_get_task` to get:
- `name` (from ClickUp; for plugin tasks, override with the SPEC.md first heading if available)
- `status.type`
- `due_date`
- `subtasks` (for percentage calculation)

Calculate `percentage` per FR-8 of the spec (`docs/superpowers/specs/2026-04-26-daily-slack-sprint-design.md`). For plugin tasks at exactly 90, use `gh pr view <url> --json state` for each PR URL; if all merged, upgrade to 100.

Build `current_tasks.json`: an array of `{clickup_id, name, url, percentage, status_type, due_date, source, slug, pr_urls}`.

## Step 7 — Resolve Cutoff and Snapshot

1. Glob `<workspace>/drafts/slack/*-<channel>.md`.
2. For each file, read frontmatter; filter by `status: published`.
3. Pick the entry with the latest `published_at`.
4. If found, write its `task_snapshots` map to a temp file `<workspace>/.cache/snapshot-<sprint>-<channel>.json`. The cutoff timestamp is `published_at`.
5. If none found, no snapshot file is created. Cutoff = null (first-run).

## Step 8 — Bucket via `bin/daily-slack-bucket.mjs`

```bash
node <plugin-root>/bin/daily-slack-bucket.mjs \
  --current <workspace>/.cache/current-tasks.json \
  --snapshot <workspace>/.cache/snapshot-<sprint>-<channel>.json
```

Capture stdout JSON: `{achieved, not_achieved, new_snapshot, first_run}`.

## Step 9 — Fetch Reasons for Stuck Tasks

For each task in `not_achieved`:
1. Call `clickup_get_task_comments(task_id)`. Extract latest 1-2 with `date_iso > cutoff`. If none after cutoff, take the most recent overall.
2. For plugin tasks with PR URLs: run `gh pr view <url> --json state,isDraft,mergeable,statusCheckRollup`. Map `statusCheckRollup` to `checks: "failing"` if any check failed.
3. Write `<workspace>/.cache/task-<clickup_id>.json`:
   ```json
   { "cutoff": "<iso-or-null>", "comments": [{"date_iso": "...", "text": "..."}], "pr_states": {...} }
   ```
4. Run:
   ```bash
   node <plugin-root>/bin/daily-slack-extract-reason.mjs --task <workspace>/.cache/task-<clickup_id>.json
   ```
   Capture stdout as `reason` for that task.

Attach `reason` to each task in `not_achieved`.

## Step 10 — Render Automated Placeholders

Build `<workspace>/.cache/render-data.json`:
```json
{
  "first_run": <bool>,
  "achieved": [{"name": "...", "url": "...", "percentage": <int>}, ...],
  "not_achieved": [{"name": "...", "url": "...", "reason": "..."}, ...],
  "short_term": [{"name": "...", "url": "...", "due_date": "<iso-or-null>"}, ...]
}
```

`short_term` is built from the union task set (any task with a `due_date`).

```bash
node <plugin-root>/bin/daily-slack-render.mjs --data <workspace>/.cache/render-data.json
```

Capture stdout JSON: `{achieved_goals, not_achieved_goals, short_term_goals}`.

## Step 11 — Check Existing Draft

Look for `<workspace>/drafts/slack/<sprint>-<channel>.md`:
- `status: draft` → ask via `question`: "A draft exists for sprint <sprint> on #<channel>. Resume editing it, or regenerate?". On resume, load the body and skip to Step 14.
- `status: published` → ask: "This sprint already has a published report on #<channel>. Re-post it, or regenerate?". On re-post, skip to Step 15. On regenerate, continue to Step 12.

## Step 12 — Prompt Manual Fields

For each field in `manual_fields` (in order):
1. Read prompt from `manual_prompts.<field>`.
2. For `planned_achievements`, append helper context to the prompt: a comma-separated list of stuck task names from Step 8. Example: `(in progress: Migration, API node)`.
3. Ask via `question` and store the response.

## Step 13 — Compose, Save, and Scan

1. Substitute every `{{placeholder}}` in the template body with the rendered value (automated from Step 10, manual from Step 12). Use plain string replacement; do not LLM-rewrite the result.
2. Build the allowlist file `<workspace>/.cache/url-allowlist.txt`: one URL per line for every `clickup_url` in the union task set, plus every URL value read from the involved `CLICKUP_TASK.json` files this run.
3. Write the composed body to `<workspace>/.cache/composed-body.md`.
4. Run the URL safety scan:
   ```bash
   node <plugin-root>/bin/daily-slack-scan-urls.mjs \
     --body <workspace>/.cache/composed-body.md \
     --allowlist <workspace>/.cache/url-allowlist.txt
   ```
5. If exit code is 1, abort with the script's stderr message and DO NOT save the draft. The user must investigate the unknown URL and re-run.
6. On exit 0, save the draft to `<workspace>/drafts/slack/<sprint>-<channel>.md`:
   ```yaml
   ---
   channel: "#<channel>"
   sprint: <sprint>
   status: draft
   published_at:
   task_snapshots:
     <id>:
       name: "..."
       url: "..."
       percentage: <int>
       status_type: "..."
   ---
   <body>
   ```
   The `task_snapshots` map is `new_snapshot` from Step 8.

## Step 14 — Present for Review

1. Display the composed body to the user.
2. Ask via `question`: "Here's the draft for #<channel> (sprint <sprint>). Ready to post, or do you want to edit anything?"
3. If edits requested:
   - Apply changes to the body.
   - Re-run the URL safety scan from Step 13. Abort if it fires.
   - Re-save the draft.
   - Re-present.
4. On approval, continue to Step 15.

## Step 15 — Publish to Slack

1. Post via `mcp__claude_ai_Slack__slack_send_message` to `#<channel>`.
   - On unavailable, fall back to `mcp__plugin_slack_slack__slack_send_message`.
   - On both unavailable, tell the user: "Slack MCP is not available. The draft has been saved at `<path>` — you can post it manually."
2. On success: update the draft frontmatter to `status: published` and `published_at: <ISO-8601>`. The snapshot remains in frontmatter and rolls forward to the next run.
3. On failure: report the error, keep `status: draft`.
```

- [ ] **Step 2: Commit**

```bash
git add jelou/workflows/daily-slack.md
git commit -m "feat(daily-slack-workflow): rewrite for sprint-scoped flow with bin scripts"
```

---

### Task 8: Update `.opencode/commands/jlu-daily-slack.md`

**Files:**
- Modify: `.opencode/commands/jlu-daily-slack.md`

- [ ] **Step 1: Update the OpenCode placeholder**

Overwrite `.opencode/commands/jlu-daily-slack.md`:

```markdown
---
description: Phase 2 Slack integration placeholder
agent: build
---
`jlu-daily-slack` is deferred to Phase 2 in OpenCode portability mode.

Do not execute Slack MCP actions yet. Explain that this command is planned for Phase 2 and list what will be added: sprint task discovery, channel template resolution, delta-based bucketing, preview/approval loop, and MCP delivery.

Command arguments: $ARGUMENTS
```

- [ ] **Step 2: Commit**

```bash
git add .opencode/commands/jlu-daily-slack.md
git commit -m "docs(opencode): update jlu-daily-slack placeholder for sprint scope"
```

---

### Task 9: Update `README.md` and any other doc references

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md` (only if it references the old name)

- [ ] **Step 1: Find every reference**

```bash
grep -rn "jlu-post-slack\|jlu:post-slack\|/post-slack" --include="*.md" --include="*.json" . | grep -v node_modules | grep -v "docs/superpowers/specs/2026-03-19" | grep -v "docs/superpowers/plans/2026-03-19" | grep -v "CHANGELOG.md"
```

Expected hits: README.md, AGENTS.md, possibly nothing else.

- [ ] **Step 2: Update each hit**

For every file in the grep output, replace `jlu-post-slack` (and `/post-slack` markdown links) with `jlu-daily-slack`. Update the one-liner description to mention the sprint argument:

> `/jlu-daily-slack <sprint> #channel` — Generate and post a sprint-scoped daily summary to a Slack channel.

For any one-line listings of plugin commands (e.g., README "Commands" table), preserve the table shape and replace only the relevant row.

- [ ] **Step 3: Verify no leftover references**

```bash
grep -rn "jlu-post-slack\|jlu:post-slack" --include="*.md" --include="*.json" . | grep -v node_modules | grep -v "docs/superpowers/specs/2026-03-19" | grep -v "docs/superpowers/plans/2026-03-19" | grep -v "CHANGELOG.md"
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: rename jlu-post-slack references to jlu-daily-slack"
```

---

### Task 10: Run all unit tests and manual smoke check

**Files:** none

- [ ] **Step 1: Run the full unit-test suite**

```bash
node --test tests/unit/
```

Expected: every existing test plus the four new ones pass. No regressions.

- [ ] **Step 2: Smoke-check the renamed command in a real workspace**

In a workspace that has `.spec-workspace.json` and at least one `<workspace>/specs/*/CLICKUP_TASK.json`, dry-run by checking that:
- `skills/daily-slack/SKILL.md` is loadable (no syntax errors in frontmatter).
- `bin/daily-slack-*.mjs` are all executable and respond to `--help`-style invalid args with exit code 2 and a usage message.

```bash
for f in bin/daily-slack-*.mjs; do
  node "$f" 2>&1 | head -1
done
```

Expected: each prints a `error: --... is required` line and the script exits non-zero.

- [ ] **Step 3: End-to-end check (live, requires ClickUp + Slack MCP)**

Manually run the command against a real workspace:
- Skip if no ClickUp/Slack MCP configured.
- Run `/jlu-daily-slack <sprint> #<test-channel>`.
- Verify: prompts for ClickUp email on first run, persists to `<workspace>/registry/clickup-user.json`, generates Spanish dailyBrain body, URL scan passes, draft saves, posts after approval, snapshot appears in published frontmatter.

This step is manual; the orchestrator cannot automate it. Document any issues found and address before merging.

---

## Self-Review Checklist (run after completing all tasks)

- [ ] Spec FR-1 through FR-20 each map to at least one task. (Done: arguments → Task 1+7; identity → 7; MCP probe → 7; discovery → 7; template → 6; per-task struct → 7; percentage → 7; cutoff → 7; bucketing → 3+7; reason → 4+7; rendering → 5+7; manual fields → 7; substitution → 7; URL scan → 2+7; draft check → 7; persistence → 7; review → 7; publish → 7.)
- [ ] No "TODO" / "TBD" / "implement later" strings appear in any task.
- [ ] Every code block compiles or runs as written.
- [ ] Test names in each `test(...)` call are unique within their describe block.
- [ ] All bin scripts use the same arg-parsing style (`for` loop with `argv[++i]`).
- [ ] No task references a function not defined in this plan or the spec.
