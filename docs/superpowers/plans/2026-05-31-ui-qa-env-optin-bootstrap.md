# ui-qa-run E2E Env Opt-in + Playwright Bootstrap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/jlu-ui-qa-run` opt-in on its E2E target (never production by accident) and bootstrap Playwright infrastructure when a UI service lacks it, without ever turning a missing E2E gate green.

**Architecture:** A new stdlib-only `bin/classify-e2e-target.mjs` helper classifies a URL as `safe`|`prod` (default-deny). The workflow `ui-qa-run.md` enforces that `E2E_BASE_URL` comes from `.env.e2e`, calls the classifier, and adds a per-UI-service Playwright-infra check whose bootstrap gate dispatches the `jlu-ui-e2e-writer` agent in a new `MODE=bootstrap`. The writer scaffolds `playwright.config.ts` + an auth fixture stub + installs `@playwright/test`, then falls through to its existing `derive-from-spec` behavior. Every new refusal path exits 2 (BLOCKED).

**Tech Stack:** Node.js (ESM, `node:test`), Bash (inside the workflow markdown), Markdown workflow/agent/reference docs, `bin/sync-agents.mjs` for the OpenCode mirror.

**Note on step numbering:** The design doc referred to the bootstrap gate as "step 11b". During planning the placement was refined to **step 7b** — immediately before the existing step 7c writer dispatch, which is where the writer is actually first invoked and where the worktree is already resolved. This plan uses 7b. Functionally identical to the design; only the anchor moved.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `bin/classify-e2e-target.mjs` | Pure URL → `safe`\|`prod` classifier + CLI | Create |
| `tests/unit/classify-e2e-target.test.mjs` | Unit coverage for the classifier (function + CLI) | Create |
| `tests/unit/ui-qa-run-workflow.test.mjs` | Structural invariants for the workflow/agent/reference markdown edits | Create |
| `jelou/references/e2e-environment.md` | `.env.e2e`-mandatory contract + target classification docs | Modify |
| `agents/jlu-ui-e2e-writer.md` | New `MODE=bootstrap` (scaffold infra → derive) | Modify |
| `jelou/workflows/ui-qa-run.md` | `--allow-prod-target` flag, step 7b bootstrap gate, step 15 env enforcement, failure-mode rows | Modify |
| `.opencode/agents/jlu-ui-e2e-writer.md` | OpenCode mirror | Regenerate via `bin/sync-agents.mjs` (never hand-edit) |

---

## Task 1: `classify-e2e-target.mjs` helper (TDD)

**Files:**
- Create: `bin/classify-e2e-target.mjs`
- Test: `tests/unit/classify-e2e-target.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/classify-e2e-target.test.mjs`:

```javascript
// tests/unit/classify-e2e-target.test.mjs
//
// Tests for bin/classify-e2e-target.mjs — the default-deny URL classifier used
// by ui-qa-run.md Phase 3 step 15 to refuse production E2E targets.
//
// Run: `node --test tests/unit/classify-e2e-target.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyTarget } from '../../bin/classify-e2e-target.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', '..', 'bin', 'classify-e2e-target.mjs');

describe('classify-e2e-target — classifyTarget()', () => {
  const cases = [
    ['http://localhost:3000', 'safe'],
    ['http://127.0.0.1:8080', 'safe'],
    ['http://[::1]:3000', 'safe'],
    ['https://app.local', 'safe'],
    ['https://staging.jelou.ai', 'safe'],
    ['https://app-dev.jelou.ai', 'safe'],
    ['https://sandbox.jelou.ai', 'safe'],
    ['https://qa.jelou.ai', 'safe'],
    ['https://my-test.jelou.ai', 'safe'],
    ['https://apps.jelou.ai', 'prod'],
    ['https://workflows.jelou.ai', 'prod'],
    ['https://latest.jelou.ai', 'prod'],
    ['not-a-url', 'prod'],
    ['', 'prod'],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} -> ${expected}`, () => {
      assert.equal(classifyTarget(input), expected);
    });
  }
  test('null/undefined -> prod (fail-safe)', () => {
    assert.equal(classifyTarget(null), 'prod');
    assert.equal(classifyTarget(undefined), 'prod');
  });
});

describe('classify-e2e-target — CLI', () => {
  function run(arg) {
    const r = spawnSync('node', [SCRIPT, arg], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim() };
  }
  test('prints safe and exits 0 for localhost', () => {
    const r = run('http://localhost:3000');
    assert.equal(r.code, 0);
    assert.equal(r.out, 'safe');
  });
  test('prints prod and exits 0 for a production host', () => {
    const r = run('https://apps.jelou.ai');
    assert.equal(r.code, 0);
    assert.equal(r.out, 'prod');
  });
  test('--version prints a version and exits 0', () => {
    const r = run('--version');
    assert.equal(r.code, 0);
    assert.match(r.out, /^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/classify-e2e-target.test.mjs`
Expected: FAIL — `Cannot find module '.../bin/classify-e2e-target.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `bin/classify-e2e-target.mjs`:

```javascript
#!/usr/bin/env node
// bin/classify-e2e-target.mjs — classify an E2E_BASE_URL as `safe` or `prod`.
//
// Default-deny: a target is `safe` only when its host is obviously non-production.
// Everything else — including apps.jelou.ai / workflows.jelou.ai — is `prod`.
// Invalid or empty input classifies as `prod` (fail-safe).
//
// Usage:
//   node bin/classify-e2e-target.mjs <url>   # prints "safe" or "prod"
//   node bin/classify-e2e-target.mjs --version
//
// Always exits 0 — callers branch on the printed string, not the exit code.

import { argv, stdout, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.0';

// Tokens that mark a host segment as a non-production environment.
const SAFE_TOKENS = ['staging', 'dev', 'sandbox', 'qa', 'test'];
// Match a token only on host-segment boundaries (start/end or '.'/'-'),
// so "latest" does NOT match "test" and "devops" does NOT match "dev".
const SAFE_TOKEN_RE = new RegExp(`(^|[.-])(${SAFE_TOKENS.join('|')})([.-]|$)`);

export function classifyTarget(raw) {
  if (!raw || typeof raw !== 'string') return 'prod';
  let host;
  try {
    host = new URL(raw).hostname;
  } catch {
    return 'prod';
  }
  if (!host) return 'prod';
  const h = host.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return 'safe';
  if (h.endsWith('.local')) return 'safe';
  if (SAFE_TOKEN_RE.test(h)) return 'safe';
  return 'prod';
}

function main() {
  const arg = argv[2];
  if (arg === '--version') {
    stdout.write(`${VERSION}\n`);
    exit(0);
  }
  stdout.write(`${classifyTarget(arg)}\n`);
  exit(0);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/classify-e2e-target.test.mjs`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add bin/classify-e2e-target.mjs tests/unit/classify-e2e-target.test.mjs
git commit -m "feat(ui-qa): add classify-e2e-target helper (default-deny prod gate)"
```

---

## Task 2: Workflow-invariant test (RED for the markdown edits)

This test asserts the structural contract that Tasks 3–5 introduce. Write it now so it fails, then the doc edits make it pass.

**Files:**
- Create: `tests/unit/ui-qa-run-workflow.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ui-qa-run-workflow.test.mjs`:

```javascript
// tests/unit/ui-qa-run-workflow.test.mjs
//
// Structural assertions for the E2E env-opt-in + Playwright-bootstrap contract
// across jelou/workflows/ui-qa-run.md, agents/jlu-ui-e2e-writer.md, and
// jelou/references/e2e-environment.md. These guard against silent regressions
// where someone removes the .env.e2e enforcement, the anti-prod gate, the
// bootstrap mode, or the BLOCKED failure rows.
//
// Run: `node --test tests/unit/ui-qa-run-workflow.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('ui-qa-run.md — env opt-in', () => {
  const wf = read('jelou/workflows/ui-qa-run.md');

  test('documents the --allow-prod-target flag', () => {
    assert.match(wf, /--allow-prod-target/);
  });

  test('requires .env.e2e to declare E2E_BASE_URL', () => {
    assert.match(wf, /\.env\.e2e missing/);
    assert.match(wf, /E2E_BASE_URL=/);
  });

  test('calls classify-e2e-target before running Playwright', () => {
    assert.match(wf, /classify-e2e-target\.mjs/);
    assert.match(wf, /points at production/);
  });
});

describe('ui-qa-run.md — bootstrap gate', () => {
  const wf = read('jelou/workflows/ui-qa-run.md');

  test('has a Playwright infrastructure check', () => {
    assert.match(wf, /Playwright infrastructure check/i);
  });

  test('dispatches the writer in MODE=bootstrap on accept', () => {
    assert.match(wf, /MODE=bootstrap/);
  });

  test('declining the bootstrap blocks (E2E mandatory)', () => {
    assert.match(wf, /Playwright infra required[\s\S]{0,120}mandatory for frontend/i);
  });
});

describe('ui-qa-run.md — failure modes', () => {
  const wf = read('jelou/workflows/ui-qa-run.md');

  test('table includes the new BLOCKED rows', () => {
    assert.match(wf, /\.env\.e2e` missing/);
    assert.match(wf, /points at prod/i);
    assert.match(wf, /declined bootstrap/i);
    assert.match(wf, /install failed/i);
  });
});

describe('e2e-environment.md — contract', () => {
  const ref = read('jelou/references/e2e-environment.md');

  test('mandates E2E_BASE_URL be declared in .env.e2e', () => {
    assert.match(ref, /\.env\.e2e/);
    assert.match(ref, /E2E_BASE_URL[\s\S]{0,200}\.env\.e2e/);
  });

  test('documents safe-vs-prod target classification', () => {
    assert.match(ref, /classify-e2e-target/);
    assert.match(ref, /default-deny/i);
  });
});

describe('jlu-ui-e2e-writer.md — bootstrap mode', () => {
  const agent = read('agents/jlu-ui-e2e-writer.md');

  test('documents MODE=bootstrap', () => {
    assert.match(agent, /bootstrap/);
    assert.match(agent, /playwright\.config\.ts/);
  });

  test('scaffolds into a dedicated tests/e2e dir (no Vitest collision)', () => {
    assert.match(agent, /tests\/e2e/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/ui-qa-run-workflow.test.mjs`
Expected: FAIL — multiple assertions fail (none of the markdown contains these strings yet).

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/unit/ui-qa-run-workflow.test.mjs
git commit -m "test(ui-qa): RED invariants for env opt-in + bootstrap contract"
```

---

## Task 3: `e2e-environment.md` contract

**Files:**
- Modify: `jelou/references/e2e-environment.md`

- [ ] **Step 1: Replace the "Required env vars" section header paragraph**

Find this block (currently around the "Required env vars" heading):

```markdown
## Required env vars

The Playwright run refuses to start unless these are set:

| Variable | Purpose | Example |
|----------|---------|---------|
| `E2E_BASE_URL` | `playwright.config.ts` `use.baseURL`. All `page.goto('/x')` calls are resolved against it. | `http://localhost:3000` |
```

Replace it with:

```markdown
## Required env vars

The Playwright run refuses to start unless these are set:

| Variable | Purpose | Example |
|----------|---------|---------|
| `E2E_BASE_URL` | `playwright.config.ts` `use.baseURL`. All `page.goto('/x')` calls are resolved against it. **Must be declared in `.env.e2e`** (see below). | `http://localhost:3000` |

### `E2E_BASE_URL` must come from `.env.e2e` — never `.env`

The app's own `.env` typically points at production (`apps.jelou.ai`, `workflows.jelou.ai`). To guarantee the E2E target is a deliberate choice and never inherited from the app config, `/jlu-ui-qa-run` requires `E2E_BASE_URL` to be declared in the E2E-specific `.env.e2e` overlay:

```bash
[ -f .env.e2e ] || { echo "ERROR: .env.e2e missing"; exit 2; }
grep -qE '^[[:space:]]*E2E_BASE_URL=' .env.e2e || { echo "ERROR: .env.e2e must declare E2E_BASE_URL"; exit 2; }
```

Loading order is unchanged (`.env` then `.env.e2e` overlay) — only the *source* of `E2E_BASE_URL` is constrained. Per-flow vars may still live in either file.

### Target classification (safe vs prod)

After resolving `E2E_BASE_URL`, the workflow classifies it with `bin/classify-e2e-target.mjs <url>`, which prints `safe` or `prod`. The rule is **default-deny**: a host is `safe` only when it is obviously non-production —

- host is `localhost`, `127.0.0.1`, `::1`, or ends in `.local`; or
- a host segment (bounded by start/end or `.`/`-`) is one of `staging`, `dev`, `sandbox`, `qa`, `test`.

Everything else — including `apps.jelou.ai` and `workflows.jelou.ai` — and any unparseable/empty input classifies as `prod`. A `prod` target aborts the run (exit 2) unless `--allow-prod-target` is passed.
```

- [ ] **Step 2: Run the workflow-invariant test to verify the e2e-environment assertions pass**

Run: `node --test tests/unit/ui-qa-run-workflow.test.mjs`
Expected: the two `e2e-environment.md — contract` tests now PASS (the rest still fail — that's Tasks 4–5).

- [ ] **Step 3: Commit**

```bash
git add jelou/references/e2e-environment.md
git commit -m "docs(ui-qa): mandate .env.e2e for E2E_BASE_URL + document target classification"
```

---

## Task 4: `jlu-ui-e2e-writer` MODE=bootstrap

**Files:**
- Modify: `agents/jlu-ui-e2e-writer.md`
- Regenerate: `.opencode/agents/jlu-ui-e2e-writer.md` (via `bin/sync-agents.mjs`)

- [ ] **Step 1: Extend the `<MODE>` input enum**

Find (in the `## Inputs` section):

```markdown
- `<MODE>` — operation mode (default: `normal`). Either:
  - `normal` — `<TASK_DIR>/services/<UI_SERVICE_ID>/user-flow.md` already exists (authored during `/jlu:refine-task` or by hand). Skip to the per-flow extraction in Process step 1.
  - `derive-from-spec` — no `user-flow.md` exists yet. Read `SPEC.md` directly and generate `<TASK_DIR>/services/<UI_SERVICE_ID>/user-flow.md` first (see "Deriving user-flow.md from SPEC.md" below), then continue with the normal flow against the generated file. **E2E is mandatory for any UI service** — never refuse a `derive-from-spec` dispatch on the grounds that the spec didn't pre-author `user-flow.md`.
```

Replace with:

```markdown
- `<MODE>` — operation mode (default: `normal`). One of:
  - `normal` — `<TASK_DIR>/services/<UI_SERVICE_ID>/user-flow.md` already exists (authored during `/jlu:refine-task` or by hand). Skip to the per-flow extraction in Process step 1.
  - `derive-from-spec` — no `user-flow.md` exists yet. Read `SPEC.md` directly and generate `<TASK_DIR>/services/<UI_SERVICE_ID>/user-flow.md` first (see "Deriving user-flow.md from SPEC.md" below), then continue with the normal flow against the generated file. **E2E is mandatory for any UI service** — never refuse a `derive-from-spec` dispatch on the grounds that the spec didn't pre-author `user-flow.md`.
  - `bootstrap` — the UI service worktree has no Playwright infrastructure. Scaffold it (see "Bootstrapping Playwright infrastructure" below), then fall through to `derive-from-spec`. The orchestrator only dispatches this mode after obtaining the user's confirmation, so you do not prompt — you scaffold. If scaffolding or dependency install fails, report `BLOCKED` with the exact manual command to run.
```

- [ ] **Step 2: Carve the `playwright.config.ts` exception in `## Outputs`**

Find (in `## Outputs`, the "You do NOT write" list):

```markdown
You do NOT write:

- UI source code (the implementer agent does that).
- `playwright.config.ts` (the consumer service owns it).
- New `data-testid` attributes in UI source code (forbidden — see Refuse to invent).
```

Replace with:

```markdown
You do NOT write:

- UI source code (the implementer agent does that).
- `playwright.config.ts` — **except in `MODE=bootstrap`**, where you scaffold it (only when absent) into a dedicated `tests/e2e/` directory. Once it exists, it is consumer-owned: never overwrite it.
- New `data-testid` attributes in UI source code (forbidden — see Refuse to invent).
```

- [ ] **Step 3: Add the "Bootstrapping Playwright infrastructure" section**

Insert this new section immediately **before** the `## Deriving user-flow.md from SPEC.md (mode: derive-from-spec)` heading:

````markdown
## Bootstrapping Playwright infrastructure (mode: bootstrap)

When dispatched with `MODE=bootstrap`, the UI service worktree has no Playwright infra and the orchestrator has already obtained user confirmation. Scaffold the minimum runnable setup, then fall through to `derive-from-spec`.

**Idempotency first.** For each artifact below, write it only if absent. Never overwrite a pre-existing `playwright.config.{ts,js}` or fixture — those are consumer-owned.

1. **`<UI_SERVICE_WORKTREE>/tests/e2e/playwright.config.ts`** — dedicated dir so it does not collide with any existing Vitest suite (e.g. `libs/builder/src/e2e`):

   ```typescript
   import { defineConfig } from '@playwright/test';
   import 'dotenv/config';

   function requireEnv(name: string): string {
     const v = process.env[name];
     if (!v) throw new Error(`Missing required env var: ${name}. See references/e2e-environment.md.`);
     return v;
   }

   export default defineConfig({
     testDir: '.',
     use: {
       baseURL: requireEnv('E2E_BASE_URL'),
       trace: 'on-first-retry',
     },
   });
   ```

2. **`<UI_SERVICE_WORKTREE>/tests/e2e/fixtures/auth.ts`** — auth fixture stub the implementer wires up during GREEN:

   ```typescript
   // Auth fixture stub — generated by jlu-ui-e2e-writer (MODE=bootstrap).
   // The implementer must replace the body with a real programmatic login
   // (no fabricated tokens). See references/auth-fixtures.md.
   import type { Page, APIRequestContext } from '@playwright/test';

   export async function signInAs(page: Page, request: APIRequestContext, role: string): Promise<void> {
     throw new Error(`signInAs not yet implemented for role "${role}". Wire this up during GREEN — see references/auth-fixtures.md.`);
   }
   ```

3. **Install `@playwright/test`.** Detect the package manager from the lockfile in the worktree and run the matching install plus the Chromium browser download:
   - `pnpm-lock.yaml` → `pnpm add -D @playwright/test && pnpm exec playwright install chromium`
   - `yarn.lock` → `yarn add -D @playwright/test && yarn playwright install chromium`
   - else → `npm install -D @playwright/test && npx playwright install chromium`

   If install fails (network, registry, permissions), report `BLOCKED` and quote the exact command so the user can run it manually. Do not proceed to derive on a failed install.

After scaffolding succeeds, continue with the `derive-from-spec` flow below (generate `user-flow.md`, then the `*.spec.ts` files). The config you wrote satisfies the `baseURL = requireEnv('E2E_BASE_URL')` contract, so the later `playwright.config.ts` read in Process step 3d will not flag a hard-coded baseURL.
````

- [ ] **Step 4: Update Process step 0 to cover bootstrap**

Find (in `## Process`, the code-fenced block, line beginning `0.`):

```
0. (derive-from-spec mode only) If <TASK_DIR>/services/<UI_SERVICE_ID>/user-flow.md does not exist,
   apply the rules in "Deriving user-flow.md from SPEC.md" above and write the file. Then continue.
```

Replace with:

```
0. (bootstrap mode) Scaffold Playwright infra per "Bootstrapping Playwright infrastructure" above
   (idempotent; skip artifacts that already exist). On install failure, report BLOCKED. Then fall
   through to step 0' as if MODE=derive-from-spec.
0'. (derive-from-spec OR bootstrap mode) If <TASK_DIR>/services/<UI_SERVICE_ID>/user-flow.md does not
   exist, apply the rules in "Deriving user-flow.md from SPEC.md" above and write the file. Then continue.
```

- [ ] **Step 5: Add `bootstrap` to the Completion Status / BLOCKED protocol**

Find (in `## Completion Status Protocol`):

```markdown
- **BLOCKED** — Cannot make tests compile after 3 attempts, or the consumer service has no Playwright config and the orchestrator did not provide a default. State what was tried.
```

Replace with:

```markdown
- **BLOCKED** — Cannot make tests compile after 3 attempts; OR (`MODE=bootstrap`) the `@playwright/test` install failed. State what was tried and quote the exact manual install command.
```

- [ ] **Step 6: Regenerate the OpenCode mirror**

Run: `node bin/sync-agents.mjs`
Then verify no drift: `node bin/sync-agents.mjs --check`
Expected: `--check` exits 0 (mirror in sync).

- [ ] **Step 7: Run the writer assertions**

Run: `node --test tests/unit/ui-qa-run-workflow.test.mjs`
Expected: the two `jlu-ui-e2e-writer.md — bootstrap mode` tests now PASS.

- [ ] **Step 8: Commit**

```bash
git add agents/jlu-ui-e2e-writer.md .opencode/agents/jlu-ui-e2e-writer.md
git commit -m "feat(ui-qa): add MODE=bootstrap to jlu-ui-e2e-writer (scaffold Playwright infra)"
```

---

## Task 5: `ui-qa-run.md` workflow wiring

**Files:**
- Modify: `jelou/workflows/ui-qa-run.md`

- [ ] **Step 1: Add the `--allow-prod-target` flag to Inputs**

Find (in `## Inputs`, the flags list):

```markdown
  - `--allow-test-edits` — let the fix-loop edit `.spec.ts` files (default forbids this).
  - `--workers=N` — Playwright worker count. Default 1. Refuses unsafe values unless both RAM and CPU gates pass (or `--force` is set).
```

Replace with:

```markdown
  - `--allow-test-edits` — let the fix-loop edit `.spec.ts` files (default forbids this).
  - `--allow-prod-target` — override the anti-prod E2E target gate (use sparingly; see Phase 3 step 15). Sets `ALLOW_PROD_TARGET=1` for the run.
  - `--workers=N` — Playwright worker count. Default 1. Refuses unsafe values unless both RAM and CPU gates pass (or `--force` is set).
```

- [ ] **Step 2: Add step 7b (Playwright infra check + bootstrap gate) before step 7c**

Find the start of step 7c (currently):

```markdown
   c. **If no user-flow.md exists**, do NOT exit. The spec is the source of truth — the workflow must derive scenarios from it regardless of whether `/jlu:refine-task` was previously invoked. Dispatch `jlu-ui-e2e-writer` once with `MODE=derive-from-spec` to:
```

Insert this new sub-step **immediately before** that `c.` line (i.e., between the end of step 7b's existing `b.` content and the `c.` line):

```markdown
   b'. **Playwright infrastructure check + bootstrap gate.** Before any `jlu-ui-e2e-writer` dispatch for this UI service, resolve its active worktree (via `jelou/references/worktree-resolution.md`) and check whether Playwright infra exists:

      - `@playwright/test` is present in the worktree's `package.json` (`dependencies` or `devDependencies`), AND
      - a `playwright.config.{ts,js}` exists at the worktree root OR at `tests/e2e/`.

      **If both present:** record the resolved config path (root vs `tests/e2e/`) as `PLAYWRIGHT_CONFIG` for Phase 3 step 15, then continue to step 7c.

      **If either is missing:** run the bootstrap gate. Invoke `AskUserQuestion`:

      > "`<UI_SERVICE_ID>` has no Playwright infrastructure. I will create in your repo: `tests/e2e/playwright.config.ts`, `tests/e2e/fixtures/auth.ts`, and add `@playwright/test` (devDependency) and install it. Proceed?"

      - **Declined** → abort with `STATUS: BLOCKED`, exit 2: "Playwright infra required for `<UI_SERVICE_ID>`; E2E is mandatory for frontend changes."
      - **Accepted** → dispatch `jlu-ui-e2e-writer` with `MODE=bootstrap` (passing `<TASK_DIR>`, `<UI_SERVICE_ID>`, `<UI_SERVICE_WORKTREE>`). The agent scaffolds the infra and then derives `user-flow.md` + specs (it falls through to `derive-from-spec`). If the agent reports `BLOCKED` (install failed) → abort with exit 2 and surface the manual install command it quoted. On success, set `PLAYWRIGHT_CONFIG=tests/e2e/playwright.config.ts` and mark this service's derivation **already done** — skip the separate `MODE=derive-from-spec` dispatch in step 7c.
```

- [ ] **Step 3: Gate step 7c's dispatch on the bootstrap not having run**

Find the same `c.` line and prepend a precondition sentence. Change:

```markdown
   c. **If no user-flow.md exists**, do NOT exit. The spec is the source of truth — the workflow must derive scenarios from it regardless of whether `/jlu:refine-task` was previously invoked. Dispatch `jlu-ui-e2e-writer` once with `MODE=derive-from-spec` to:
```

to:

```markdown
   c. **If no user-flow.md exists AND step 7b' did not already bootstrap this service**, do NOT exit. The spec is the source of truth — the workflow must derive scenarios from it regardless of whether `/jlu:refine-task` was previously invoked. (When step 7b' dispatched `MODE=bootstrap`, derivation already happened — skip this dispatch.) Dispatch `jlu-ui-e2e-writer` once with `MODE=derive-from-spec` to:
```

- [ ] **Step 4: Enforce `.env.e2e` and classify the target in step 15**

Find this block in Phase 3 step 15 (the env-loading bash):

```bash
    cd "$UI_WORKTREE"

    # Load .env (per docker-conventions.md it was copied into the worktree at task creation)
    # and the optional .env.e2e overlay. set -a exports every assignment to child processes.
    set -a
    [ -f .env ]     && . ./.env
    [ -f .env.e2e ] && . ./.env.e2e
    set +a

    # Mandatory: baseURL must come from env, not be hard-coded in playwright.config.ts.
    : "${E2E_BASE_URL:?missing E2E_BASE_URL — set it in .env or .env.e2e (see references/e2e-environment.md)}"
```

Replace with:

```bash
    cd "$UI_WORKTREE"

    # Opt-in env target: E2E_BASE_URL MUST be declared in .env.e2e, never inherited
    # from the app's .env (which typically points at production). See references/e2e-environment.md.
    if [ ! -f .env.e2e ]; then
      echo "ERROR: .env.e2e missing for $UI_SERVICE. E2E never runs with the app's .env config."
      echo "  Create .env.e2e and set E2E_BASE_URL. See references/e2e-environment.md."
      exit 2
    fi
    if ! grep -qE '^[[:space:]]*E2E_BASE_URL=' .env.e2e; then
      echo "ERROR: .env.e2e for $UI_SERVICE must declare E2E_BASE_URL explicitly."
      exit 2
    fi

    # Load .env (per docker-conventions.md it was copied into the worktree at task creation)
    # then the .env.e2e overlay. set -a exports every assignment to child processes.
    set -a
    [ -f .env ]     && . ./.env
    [ -f .env.e2e ] && . ./.env.e2e
    set +a

    # Mandatory: baseURL must come from env, not be hard-coded in playwright.config.ts.
    : "${E2E_BASE_URL:?missing E2E_BASE_URL — set it in .env.e2e (see references/e2e-environment.md)}"

    # Anti-prod gate: refuse a production-looking target unless --allow-prod-target was passed.
    # PLUGIN_ROOT is the plugin root resolved by the SKILL bootstrap (Phase 1).
    TARGET_CLASS=$(node "$PLUGIN_ROOT/bin/classify-e2e-target.mjs" "$E2E_BASE_URL")
    if [ "$TARGET_CLASS" = "prod" ] && [ -z "$ALLOW_PROD_TARGET" ]; then
      echo "ERROR: E2E_BASE_URL points at production ('$E2E_BASE_URL')."
      echo "  Pass --allow-prod-target if this is intentional."
      exit 2
    fi
```

- [ ] **Step 5: Point the Playwright run at the bootstrapped config**

Find the `npx playwright test` invocation in step 15:

```bash
    npx playwright test \
      --workers=${WORKERS:-1} \
      --reporter=json \
      --output="$TASK_DIR/services/$UI_SERVICE/e2e/playwright-output" \
      --trace=on-first-retry \
      > "$TASK_DIR/services/$UI_SERVICE/e2e/run.json" 2>&1
    EXIT_CODE=$?
```

Replace with:

```bash
    # PLAYWRIGHT_CONFIG was recorded in step 7b' (root config → empty; tests/e2e/ config → explicit path).
    CONFIG_FLAG=""
    [ -n "$PLAYWRIGHT_CONFIG" ] && [ "$PLAYWRIGHT_CONFIG" != "playwright.config.ts" ] && CONFIG_FLAG="--config=$PLAYWRIGHT_CONFIG"

    npx playwright test \
      $CONFIG_FLAG \
      --workers=${WORKERS:-1} \
      --reporter=json \
      --output="$TASK_DIR/services/$UI_SERVICE/e2e/playwright-output" \
      --trace=on-first-retry \
      > "$TASK_DIR/services/$UI_SERVICE/e2e/run.json" 2>&1
    EXIT_CODE=$?
```

- [ ] **Step 6: Add the new failure-mode rows**

Find the failure-modes table and the row:

```markdown
| UI service missing `dev` block | 2 | "UI service `<id>` is missing a `dev` block" — E2E mandatory for frontend changes; add `stack` + `dev` to services.yaml |
```

Insert these rows immediately after it:

```markdown
| `.env.e2e` missing | 2 | "`.env.e2e` missing; create it and set E2E_BASE_URL" + reference to e2e-environment.md |
| `.env.e2e` does not declare `E2E_BASE_URL` | 2 | "declare E2E_BASE_URL in .env.e2e" |
| E2E target points at prod, no override | 2 | "E2E_BASE_URL points at production `<url>`; pass `--allow-prod-target` if intentional" |
| No Playwright infra, user declined bootstrap | 2 | "Playwright infra required; E2E mandatory for frontend changes" |
| Bootstrap dependency install failed | 2 | "could not install `@playwright/test`; run `<cmd>` manually" |
```

- [ ] **Step 7: Run the full workflow-invariant test**

Run: `node --test tests/unit/ui-qa-run-workflow.test.mjs`
Expected: PASS — all assertions green.

- [ ] **Step 8: Commit**

```bash
git add jelou/workflows/ui-qa-run.md
git commit -m "feat(ui-qa): env opt-in gate + Playwright bootstrap wiring in ui-qa-run"
```

---

## Task 6: Full suite + sync verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: PASS — `node --test tests/unit/*.test.mjs` green, including the two new files.

- [ ] **Step 2: Verify the agent mirror is in sync**

Run: `node bin/sync-agents.mjs --check`
Expected: exit 0 (no drift).

- [ ] **Step 3: Confirm the working tree is clean**

Run: `git status --porcelain`
Expected: empty (all changes committed).

---

## Self-review notes

- **Spec coverage:** §1 env contract → Tasks 3, 5 (steps 4). §2 MODE=bootstrap → Task 4. §3 orchestrator flow → Task 5 (steps 2–3). §4 error handling → Task 5 (step 6) + Task 2 assertions. §5 testing → Tasks 1, 2, 6. Run-command implication (config path) → Task 5 step 5.
- **Placeholder scan:** the only `<...>` tokens are template placeholders inside generated user-facing messages (`<UI_SERVICE_ID>`, `<cmd>`, `<url>`), matching the existing workflow's idiom — not plan gaps.
- **Type consistency:** `classifyTarget` (function) and `classify-e2e-target.mjs` (CLI) match across Tasks 1, 3, 5. `PLAYWRIGHT_CONFIG` / `ALLOW_PROD_TARGET` / `PLUGIN_ROOT` env var names are consistent between step 7b', step 15, and the flag in Inputs. `MODE=bootstrap` spelled identically in Task 4 and Task 5.
- **Pre-push checklist:** Task 6 enforces `npm test` + `sync-agents --check` green before any push to `main` (per CLAUDE.md).
```
