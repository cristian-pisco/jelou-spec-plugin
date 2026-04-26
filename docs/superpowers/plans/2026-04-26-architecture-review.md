# Architecture Review Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/jlu-architecture-review` command that surfaces deepening opportunities in a service (or across services), runs an interactive grilling loop on a chosen candidate, and lazily records ADRs when candidates are rejected with load-bearing reasons.

**Architecture:** Two-agent split — `jlu-architecture-explorer` (sonnet) walks knowledge files + source code and emits a flat candidate fragment; `jlu-architecture-grill` (opus) drives a bounded interactive loop on one selected candidate, writing either a refined brief or an ADR. Two pure-Node helper scripts (`bin/architecture-review-allocate-adr.mjs`, `bin/architecture-review-render.mjs`) handle the deterministic logic that benefits from unit tests: ADR number allocation and JSON-to-markdown rendering.

**Tech Stack:** Markdown for SKILL/agent/workflow/template/reference files (Claude Code plugin convention). Node 20+ for helper scripts. `node:test` runner for unit tests (matches `tests/unit/glossary-merge.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-04-26-architecture-review-design.md`

---

## File Structure

### Files to CREATE

| Path | Responsibility |
|------|---------------|
| `bin/architecture-review-allocate-adr.mjs` | Pure-JS helper: scan `<workspace>/decisions/` for max ADR ID, print next zero-padded 4-digit number. Called by the orchestrator before dispatching the grill. |
| `bin/architecture-review-render.mjs` | Pure-JS helper: read explorer fragment JSON, write the report at the requested path. Single source of truth for the report format. |
| `tests/unit/architecture-review-allocate-adr.test.mjs` | Unit tests for the allocator. |
| `tests/unit/architecture-review-render.test.mjs` | Unit tests for the renderer. |
| `jelou/references/architecture-language.md` | Vocabulary contract — Pocock's LANGUAGE.md adapted. Both agents receive this in their prompt. |
| `jelou/templates/adr.md` | ADR file shape (frontmatter + body). Reference doc for the grill; not interpolated. |
| `jelou/templates/architecture-review.md` | Report shape. Reference doc for humans; the renderer is the runtime source of truth. |
| `agents/jlu-architecture-explorer.md` | Code-only candidate-discovery agent. Single dispatch (single or cross-service). Model: sonnet. |
| `agents/jlu-architecture-grill.md` | Interactive grilling-loop agent. Owns all user interaction once dispatched. Model: opus. |
| `jelou/workflows/architecture-review.md` | Orchestrator workflow for `/jlu-architecture-review`. |
| `skills/architecture-review/SKILL.md` | Claude-Code skill launcher. |
| `.opencode/commands/jlu-architecture-review.md` | OpenCode command launcher. |

### Files to MODIFY

| Path | Change |
|------|--------|
| `README.md` | Add `/jlu-architecture-review` to the Core Commands table. |

### Workspace-side artifacts (not files in the plugin repo)

These get written into the user's `.spec-workspace/` at runtime:

```
.spec-workspace/
├── decisions/
│   └── ADR-NNNN-<slug>.md
├── .tmp/
│   └── architecture/
│       └── <service-id>.candidates.json
└── services/
    └── <service-id>/
        codebase/
          ARCHITECTURE_REVIEW.md
          ARCHITECTURE_REVIEW.cross-service.md
```

---

## Task 1: ADR allocator — RED happy path

**Files:**
- Test: `tests/unit/architecture-review-allocate-adr.test.mjs`

The allocator scans the decisions directory for files matching `ADR-NNNN-*.md`, parses the leading 4-digit number, prints `max+1` zero-padded to stdout. On a missing or empty directory, prints `0001`.

- [ ] **Step 1: Create the test file with the first failing test**

```javascript
// tests/unit/architecture-review-allocate-adr.test.mjs
//
// Run: `node --test tests/unit/architecture-review-allocate-adr.test.mjs`
// Node 20+ required.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ALLOCATOR = new URL('../../bin/architecture-review-allocate-adr.mjs', import.meta.url).pathname;

function setupWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'arch-review-'));
  const decisions = join(root, 'decisions');
  return { root, decisions };
}

function runAllocator(args) {
  return spawnSync('node', [ALLOCATOR, ...args], { encoding: 'utf8' });
}

describe('architecture-review-allocate-adr — happy path', () => {
  test('returns 0001 when decisions/ does not exist', () => {
    const { decisions } = setupWorkspace();
    const result = runAllocator(['--decisions-dir', decisions]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stdout.trim(), '0001');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/unit/architecture-review-allocate-adr.test.mjs`

Expected: failure with `Cannot find module .../bin/architecture-review-allocate-adr.mjs` or `ENOENT`.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/unit/architecture-review-allocate-adr.test.mjs
git commit -m "test(architecture-review-allocate-adr): red — returns 0001 for missing decisions dir"
```

---

## Task 2: ADR allocator — GREEN minimal

**Files:**
- Create: `bin/architecture-review-allocate-adr.mjs`

- [ ] **Step 1: Create the helper script**

```javascript
#!/usr/bin/env node
// bin/architecture-review-allocate-adr.mjs
//
// Scans <decisions-dir> for files matching ADR-NNNN-*.md, parses the leading
// 4-digit number, prints max+1 zero-padded to stdout. On a missing or empty
// directory, prints 0001.
//
// Usage:
//   node bin/architecture-review-allocate-adr.mjs --decisions-dir <abs-path>

import { existsSync, readdirSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--decisions-dir') {
      args.decisionsDir = argv[++i];
    }
  }
  if (!args.decisionsDir) {
    console.error('error: --decisions-dir <path> is required');
    process.exit(2);
  }
  return args;
}

const ADR_RE = /^ADR-(\d{4})-[a-z0-9-]+\.md$/;

function main() {
  const { decisionsDir } = parseArgs(process.argv);
  let max = 0;
  if (existsSync(decisionsDir)) {
    for (const name of readdirSync(decisionsDir)) {
      const m = ADR_RE.exec(name);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  }
  const next = (max + 1).toString().padStart(4, '0');
  process.stdout.write(next + '\n');
}

main();
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x bin/architecture-review-allocate-adr.mjs
```

- [ ] **Step 3: Run the test and confirm it passes**

Run: `node --test tests/unit/architecture-review-allocate-adr.test.mjs`

Expected: `tests 1 passed 1`.

- [ ] **Step 4: Commit**

```bash
git add bin/architecture-review-allocate-adr.mjs
git commit -m "feat(architecture-review-allocate-adr): green — return next zero-padded ADR id"
```

---

## Task 3: ADR allocator — existing files, gap, non-ADR files

**Files:**
- Test: `tests/unit/architecture-review-allocate-adr.test.mjs` (extend)

- [ ] **Step 1: Add three more tests**

Append to the existing file (after the existing `describe` block):

```javascript
describe('architecture-review-allocate-adr — existing decisions', () => {
  test('returns max+1 when ADRs exist sequentially', () => {
    const { decisions } = setupWorkspace();
    mkdirSync(decisions, { recursive: true });
    writeFileSync(join(decisions, 'ADR-0001-first.md'), '---\nid: ADR-0001\n---\n');
    writeFileSync(join(decisions, 'ADR-0002-second.md'), '---\nid: ADR-0002\n---\n');

    const result = runAllocator(['--decisions-dir', decisions]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stdout.trim(), '0003');
  });

  test('returns max+1 even when there is a gap in numbering', () => {
    const { decisions } = setupWorkspace();
    mkdirSync(decisions, { recursive: true });
    writeFileSync(join(decisions, 'ADR-0001-first.md'), '');
    writeFileSync(join(decisions, 'ADR-0007-seventh.md'), '');

    const result = runAllocator(['--decisions-dir', decisions]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stdout.trim(), '0008');
  });

  test('ignores non-ADR files in the decisions directory', () => {
    const { decisions } = setupWorkspace();
    mkdirSync(decisions, { recursive: true });
    writeFileSync(join(decisions, 'ADR-0001-first.md'), '');
    writeFileSync(join(decisions, 'README.md'), '');
    writeFileSync(join(decisions, 'notes.txt'), '');
    writeFileSync(join(decisions, 'ADR-bad.md'), '');

    const result = runAllocator(['--decisions-dir', decisions]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stdout.trim(), '0002');
  });
});
```

- [ ] **Step 2: Run the tests and confirm all pass**

Run: `node --test tests/unit/architecture-review-allocate-adr.test.mjs`

Expected: `tests 4 passed 4`.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/architecture-review-allocate-adr.test.mjs
git commit -m "test(architecture-review-allocate-adr): cover gaps and non-ADR files"
```

---

## Task 4: Renderer — RED happy path

**Files:**
- Test: `tests/unit/architecture-review-render.test.mjs`

The renderer reads a fragment JSON file (explorer output) and writes a markdown report at the requested path. Format follows the spec under "Artifact Schemas → ARCHITECTURE_REVIEW.md".

- [ ] **Step 1: Create the test file with the first failing test**

```javascript
// tests/unit/architecture-review-render.test.mjs
//
// Run: `node --test tests/unit/architecture-review-render.test.mjs`
// Node 20+ required.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RENDERER = new URL('../../bin/architecture-review-render.mjs', import.meta.url).pathname;

function setupWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'arch-review-render-'));
  const fragmentPath = join(root, 'fragment.json');
  const reportPath = join(root, 'ARCHITECTURE_REVIEW.md');
  return { root, fragmentPath, reportPath };
}

function runRenderer(args) {
  return spawnSync('node', [RENDERER, ...args], { encoding: 'utf8' });
}

describe('architecture-review-render — happy path', () => {
  test('renders a single-candidate single-mode report', () => {
    const { fragmentPath, reportPath } = setupWorkspace();
    writeFileSync(fragmentPath, JSON.stringify({
      mode: 'single',
      scope: ['svc-orders'],
      scanned_at: '2026-04-26T12:00:00Z',
      service_id: 'svc-orders',
      candidates: [
        {
          id: 1,
          title: 'Order intake module',
          files: ['src/orders/intake.ts', 'src/orders/validate.ts'],
          problem: 'The intake and validate modules are shallow — each presents an interface nearly as complex as its implementation.',
          solution: 'Merge into a single deep Order intake module behind one interface.',
          benefits: {
            leverage: 'Callers stop chaining two modules; one call accepts an Order draft and returns a validated Order.',
            locality: 'All intake-related change concentrates in one module.',
            tests: 'Tests assert outcomes through the deep interface; pure-function unit tests on validate go away.'
          },
          dependency_category: 'in-process',
          deletion_test: 'Deleting intake.ts forces every caller to recompose the validation step inline.',
          confidence: 'high'
        }
      ]
    }));

    const result = runRenderer([
      '--fragment', fragmentPath,
      '--report', reportPath,
      '--service-id', 'svc-orders'
    ]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(existsSync(reportPath), 'report file should exist');

    const body = readFileSync(reportPath, 'utf8');
    assert.match(body, /^# Architecture Review — svc-orders$/m);
    assert.match(body, /Mode: single/);
    assert.match(body, /## Candidates/);
    assert.match(body, /### #1: Order intake module/);
    assert.match(body, /\*\*Files\*\*: src\/orders\/intake\.ts, src\/orders\/validate\.ts/);
    assert.match(body, /\*\*Dependency category\*\*: in-process/);
    assert.match(body, /\*\*Confidence\*\*: high/);
    assert.match(body, /\*\*Deletion test\*\*: Deleting intake\.ts/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/unit/architecture-review-render.test.mjs`

Expected: failure with `Cannot find module .../bin/architecture-review-render.mjs` or `ENOENT`.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/unit/architecture-review-render.test.mjs
git commit -m "test(architecture-review-render): red — single-candidate happy path"
```

---

## Task 5: Renderer — GREEN minimal

**Files:**
- Create: `bin/architecture-review-render.mjs`

- [ ] **Step 1: Create the helper script**

```javascript
#!/usr/bin/env node
// bin/architecture-review-render.mjs
//
// Reads an explorer-emitted fragment JSON and writes ARCHITECTURE_REVIEW.md
// (or ARCHITECTURE_REVIEW.cross-service.md) at the requested path.
//
// Usage:
//   node bin/architecture-review-render.mjs \
//     --fragment <fragment.json> \
//     --report <report.md> \
//     --service-id <id>           (single-mode only)
//
// In cross-service mode, omit --service-id and pass --mode cross.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function parseArgs(argv) {
  const args = { mode: null, serviceId: null, fragment: null, report: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fragment') args.fragment = argv[++i];
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--service-id') args.serviceId = argv[++i];
    else if (a === '--mode') args.mode = argv[++i];
  }
  if (!args.fragment || !args.report) {
    console.error('error: --fragment <path> and --report <path> are required');
    process.exit(2);
  }
  return args;
}

function renderCandidate(c) {
  const flags = [];
  if (c.missing_domain_term) flags.push(`\`missing_domain_term: ${c.missing_domain_term}\``);
  if (c.contradicts_adr) flags.push(`\`contradicts_adr: ${c.contradicts_adr}\``);
  const flagsLine = flags.length ? `- *Optional flags:* ${flags.join(', ')}` : '';
  const lines = [
    `### #${c.id}: ${c.title}`,
    `- **Files**: ${c.files.join(', ')}`,
    `- **Problem**: ${c.problem}`,
    `- **Solution**: ${c.solution}`,
    `- **Benefits**:`,
    `  - **Leverage**: ${c.benefits.leverage}`,
    `  - **Locality**: ${c.benefits.locality}`,
    `  - **Tests**: ${c.benefits.tests}`,
    `- **Dependency category**: ${c.dependency_category}`,
    `- **Deletion test**: ${c.deletion_test}`,
    `- **Confidence**: ${c.confidence}`
  ];
  if (flagsLine) lines.push(flagsLine);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  const fragment = JSON.parse(readFileSync(args.fragment, 'utf8'));
  const mode = args.mode ?? fragment.mode ?? 'single';
  const heading = mode === 'cross'
    ? `# Architecture Review — cross-service (${(fragment.scope ?? []).join(', ')})`
    : `# Architecture Review — ${args.serviceId ?? fragment.service_id ?? 'unknown'}`;

  const date = (fragment.scanned_at ?? new Date().toISOString()).slice(0, 10);
  const lead = `> Generated by \`/jlu-architecture-review\` on ${date}. Mode: ${mode}.\n` +
    `> This report is transient — it is overwritten on each run. Briefs you want to keep should become tasks in \`specs/\`.`;

  const candidates = (fragment.candidates ?? []).map(renderCandidate).join('\n\n');

  const sections = [
    heading,
    '',
    lead,
    '',
    '## Candidates',
    '',
    candidates || '_No candidates surfaced._',
    '',
    '## Grilled candidates',
    '',
    '_None yet — pick a candidate to start the grilling loop._',
    '',
    '## Rejections',
    '',
    '_None._',
    ''
  ];

  mkdirSync(dirname(args.report), { recursive: true });
  writeFileSync(args.report, sections.join('\n'));
}

main();
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x bin/architecture-review-render.mjs
```

- [ ] **Step 3: Run the test and confirm it passes**

Run: `node --test tests/unit/architecture-review-render.test.mjs`

Expected: `tests 1 passed 1`.

- [ ] **Step 4: Commit**

```bash
git add bin/architecture-review-render.mjs
git commit -m "feat(architecture-review-render): green — render single-candidate report"
```

---

## Task 6: Renderer — multiple candidates, optional flags, cross-service

**Files:**
- Test: `tests/unit/architecture-review-render.test.mjs` (extend)

- [ ] **Step 1: Add three more tests**

Append at the bottom of the file:

```javascript
describe('architecture-review-render — multiple candidates and flags', () => {
  test('renders multiple candidates with section ordering preserved', () => {
    const { fragmentPath, reportPath } = setupWorkspace();
    writeFileSync(fragmentPath, JSON.stringify({
      mode: 'single',
      scope: ['svc-x'],
      scanned_at: '2026-04-26T12:00:00Z',
      service_id: 'svc-x',
      candidates: [
        { id: 1, title: 'A', files: ['a.ts'], problem: 'p1', solution: 's1',
          benefits: { leverage: 'l', locality: 'lo', tests: 't' },
          dependency_category: 'in-process', deletion_test: 'd', confidence: 'high' },
        { id: 2, title: 'B', files: ['b.ts'], problem: 'p2', solution: 's2',
          benefits: { leverage: 'l', locality: 'lo', tests: 't' },
          dependency_category: 'in-process', deletion_test: 'd', confidence: 'medium' }
      ]
    }));

    const result = runRenderer(['--fragment', fragmentPath, '--report', reportPath, '--service-id', 'svc-x']);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const body = readFileSync(reportPath, 'utf8');
    const idxA = body.indexOf('### #1: A');
    const idxB = body.indexOf('### #2: B');
    const idxGrilled = body.indexOf('## Grilled candidates');
    assert.ok(idxA > 0 && idxB > idxA && idxGrilled > idxB,
      'expected order: #1 → #2 → Grilled candidates');
  });

  test('emits optional flags when present', () => {
    const { fragmentPath, reportPath } = setupWorkspace();
    writeFileSync(fragmentPath, JSON.stringify({
      mode: 'single',
      scope: ['svc-x'],
      scanned_at: '2026-04-26T12:00:00Z',
      service_id: 'svc-x',
      candidates: [
        { id: 1, title: 'A', files: ['a.ts'], problem: 'p', solution: 's',
          benefits: { leverage: 'l', locality: 'lo', tests: 't' },
          dependency_category: 'remote-but-owned', deletion_test: 'd', confidence: 'low',
          missing_domain_term: 'OrderIntake', contradicts_adr: 'ADR-0003' }
      ]
    }));

    const result = runRenderer(['--fragment', fragmentPath, '--report', reportPath, '--service-id', 'svc-x']);
    assert.equal(result.status, 0);
    const body = readFileSync(reportPath, 'utf8');
    assert.match(body, /missing_domain_term: OrderIntake/);
    assert.match(body, /contradicts_adr: ADR-0003/);
  });

  test('renders a cross-service report header', () => {
    const { fragmentPath, reportPath } = setupWorkspace();
    writeFileSync(fragmentPath, JSON.stringify({
      mode: 'cross',
      scope: ['svc-a', 'svc-b'],
      scanned_at: '2026-04-26T12:00:00Z',
      candidates: [
        { id: 1, title: 'Shared port', files: ['svc-a/port.ts', 'svc-b/port.ts'], problem: 'p', solution: 's',
          benefits: { leverage: 'l', locality: 'lo', tests: 't' },
          dependency_category: 'remote-but-owned', deletion_test: 'd', confidence: 'high' }
      ]
    }));

    const result = runRenderer(['--fragment', fragmentPath, '--report', reportPath, '--mode', 'cross']);
    assert.equal(result.status, 0);
    const body = readFileSync(reportPath, 'utf8');
    assert.match(body, /^# Architecture Review — cross-service \(svc-a, svc-b\)$/m);
    assert.match(body, /Mode: cross/);
  });
});
```

- [ ] **Step 2: Run the tests and confirm all pass**

Run: `node --test tests/unit/architecture-review-render.test.mjs`

Expected: `tests 4 passed 4`.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/architecture-review-render.test.mjs
git commit -m "test(architecture-review-render): cover multi-candidate, flags, cross-service"
```

---

## Task 7: Vocabulary reference — `architecture-language.md`

**Files:**
- Create: `jelou/references/architecture-language.md`

This is the vocabulary contract both agents receive. Near-verbatim port of Pocock's LANGUAGE.md, with the plugin "service" adaptation. No code, no tests — it's a reference document loaded into agent prompts at runtime.

- [ ] **Step 1: Create the reference file**

```markdown
# Architecture Language

> Vocabulary contract for `/jlu-architecture-review`. Both `jlu-architecture-explorer` and `jlu-architecture-grill` are required to use these terms exactly. Adapted from Matt Pocock's `LANGUAGE.md`.

## Plugin adaptation

In this plugin, "service" refers to a deployment unit (a repo/codebase managed by `services.yaml`). Inside service code, **never use "service" as a module name** — say Module, Adapter, or name the concept from `UBIQUITOUS_LANGUAGE.md`.

## Terms

**Module**
Anything with an interface and an implementation. Deliberately scale-agnostic — applies equally to a function, class, package, or tier-spanning slice.
*Avoid: unit, component, service.*

**Interface**
Everything a caller must know to use the module correctly. Includes the type signature, but also invariants, ordering constraints, error modes, required configuration, and performance characteristics.
*Avoid: API, signature.*

**Implementation**
What's inside a module — its body of code. Distinct from **Adapter**: a thing can be a small adapter with a large implementation (a Postgres repo) or a large adapter with a small implementation (an in-memory fake).

**Depth**
Leverage at the interface — the amount of behaviour a caller (or test) can exercise per unit of interface they have to learn. A module is **deep** when a large amount of behaviour sits behind a small interface. A module is **shallow** when the interface is nearly as complex as the implementation.

**Seam** *(from Michael Feathers)*
A place where you can alter behaviour without editing in that place. The *location* at which a module's interface lives.
*Avoid: boundary (overloaded with DDD's bounded context).*

**Adapter**
A concrete thing that satisfies an interface at a seam. Describes *role* (what slot it fills), not substance (what's inside).

**Leverage**
What callers get from depth. More capability per unit of interface they have to learn.

**Locality**
What maintainers get from depth. Change, bugs, knowledge, and verification concentrate at one place.

## Principles

- **The deletion test.** Imagine deleting the module. If complexity vanishes, the module wasn't hiding anything. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If you want to test *past* the interface, the module is probably the wrong shape.
- **One adapter = hypothetical seam. Two adapters = real seam.** Don't introduce a port unless something actually varies across it.
- **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small, mockable parts — they just aren't part of the interface.

## Dependency categories (from Pocock's DEEPENING.md)

When proposing a deepening, classify dependencies. The category determines how the deepened module is tested across its seam.

1. **In-process** — pure computation, in-memory state, no I/O. Always deepenable. Test through the new interface directly.
2. **Local-substitutable** — dependencies with local test stand-ins (PGLite for Postgres, in-memory FS). Deepenable; the seam is internal.
3. **Remote but owned (Ports & Adapters)** — your own services across a network boundary. Define a port at the seam; production uses an HTTP/gRPC/queue adapter, tests use an in-memory adapter.
4. **True external (Mock)** — third-party services (Stripe, Twilio). The deepened module takes the external dependency as an injected port; tests provide a mock.

## Rejected framings (do not adopt)

- Depth as a ratio of implementation-lines to interface-lines (rewards padding the implementation).
- "Interface" as the TypeScript `interface` keyword or a class's public methods (too narrow — interface here includes every fact a caller must know).
- "Boundary" (overloaded with DDD's bounded context).
```

- [ ] **Step 2: Commit**

```bash
git add jelou/references/architecture-language.md
git commit -m "feat(architecture-review): add vocabulary contract reference"
```

---

## Task 8: ADR template

**Files:**
- Create: `jelou/templates/adr.md`

Reference shape for ADR files. Not interpolated — the grill agent emits the file body directly using this as a model.

- [ ] **Step 1: Create the template**

````markdown
# ADR Template

> Reference shape for ADR files written to `<workspace>/decisions/ADR-NNNN-<slug>.md`.
> The grill agent emits files matching this shape; the orchestrator never touches an ADR body.

## File shape

```markdown
---
id: ADR-<NNNN>
slug: <kebab-case-slug>
title: <one-line title>
status: accepted | superseded | deprecated
date: <YYYY-MM-DD>
service: <service-id> | workspace
supersedes: ADR-<NNNN> | null
superseded_by: ADR-<NNNN> | null
tags: [<keyword>, ...]
---

# <Title>

## Context

<2–4 sentences. The architectural friction or proposal that prompted this decision. Use ARCH_VOCAB exactly: Module, Interface, Seam, Adapter, Depth, Leverage, Locality. Use DOMAIN_TERMS for concept names.>

## Decision

<2–3 sentences. What we decided to do — including "do nothing" / "reject the proposal" framings.>

## Consequences

<1–2 paragraphs. The trade-offs accepted. What this commits us to and what it forecloses.>

## Load-bearing reason for future explorers

<MUST be filled in for rejection ADRs. Phrased so a fresh explorer with no conversation context can read it and skip the candidate.>
```

## Field rules

- **`id`**: matches the filename's `ADR-NNNN-` prefix exactly. Allocated by the orchestrator (via `bin/architecture-review-allocate-adr.mjs`); the grill never invents a number.
- **`slug`**: kebab-case, ≤ 60 chars, derived from the title.
- **`status`**: defaults to `accepted`. Set to `superseded` only via a later ADR; the original ADR's `superseded_by` is updated by hand or by a future tool (out of scope for v1).
- **`service`**: `<service-id>` for single-service decisions, `workspace` for cross-service decisions. Used by the explorer to filter `EXISTING_ADRS` in single-service mode.
- **`supersedes` / `superseded_by`**: nullable; v1 does not enforce graph integrity.
- **`tags`**: optional keyword list for future search; v1 has no search command.

## Body rules

- **Context** uses ARCH_VOCAB exactly. No "component," "boundary," "API," or "service" (as module name).
- **Load-bearing reason for future explorers** is mandatory for rejection ADRs and may be omitted for acceptance ADRs (v1 only writes ADRs from rejection paths in the grill, but the field name is preserved for future acceptance ADRs).
````

- [ ] **Step 2: Commit**

```bash
git add jelou/templates/adr.md
git commit -m "feat(architecture-review): add ADR file-shape template"
```

---

## Task 9: Architecture review report template

**Files:**
- Create: `jelou/templates/architecture-review.md`

Reference shape for `ARCHITECTURE_REVIEW.md`. Not interpolated — the renderer is the runtime source of truth for the format.

- [ ] **Step 1: Create the template**

````markdown
# Architecture Review Report Template

> Reference shape for `ARCHITECTURE_REVIEW.md` (single-service) and `ARCHITECTURE_REVIEW.cross-service.md` (cross-service).
> The runtime source of truth for this format is `bin/architecture-review-render.mjs`. Update both when the format changes.

## Single-service shape

```markdown
# Architecture Review — <service-id>

> Generated by `/jlu-architecture-review` on <YYYY-MM-DD>. Mode: single.
> This report is transient — it is overwritten on each run. Briefs you want to keep should become tasks in `specs/`.

## Candidates

### #1: <Concept-named module name>
- **Files**: <list>
- **Problem**: <2–3 sentences using ARCH_VOCAB>
- **Solution**: <plain-English description>
- **Benefits**:
  - **Leverage**: <what callers gain>
  - **Locality**: <where change concentrates>
  - **Tests**: <how the test surface improves>
- **Dependency category**: <in-process | local-substitutable | remote-but-owned | true-external>
- **Deletion test**: <one sentence>
- **Confidence**: <high|medium|low>
- *Optional flags:* `missing_domain_term: <name>`, `contradicts_adr: ADR-NNNN`

### #2: ...

## Grilled candidates

### #<N>: <title>  (status: ready for /jlu-new-task)
- **Files**: <list>
- **Problem**: <copied/refined from explorer>
- **Proposed seam**: <one paragraph>
- **Dependency category**: <category>
- **Test surface after deepening**: <one paragraph>
- **Open questions surfaced during grilling**: <bullets>

## Rejections

- #N <title>: discarded — <one-line reason>
- #N <title>: recorded as ADR-NNNN — <link>

## Terms surfaced during architecture review

> Run /jlu-ubiquitous-language to canonicalize these.

- <TermName> — <proposed one-sentence definition>
```

## Cross-service shape

The header changes to:

```markdown
# Architecture Review — cross-service (<id1>, <id2>, ...)

> Generated by `/jlu-architecture-review --cross-service` on <YYYY-MM-DD>. Mode: cross.
```

The remaining sections are identical. The cross-service file is written under each in-scope service's `codebase/ARCHITECTURE_REVIEW.cross-service.md`.

## Section semantics

| Section | Written by | When |
|---|---|---|
| Heading + lead | Renderer | On every run |
| Candidates | Renderer | On every run, from explorer fragment |
| Grilled candidates | Grill agent | Appended on each `survives` outcome |
| Rejections | Grill agent | Appended on each `rejected` outcome |
| Terms surfaced during architecture review | Grill agent | Appended only when the user opts in during grilling |
````

- [ ] **Step 2: Commit**

```bash
git add jelou/templates/architecture-review.md
git commit -m "feat(architecture-review): add report-shape template"
```

---

## Task 10: Explorer agent — `jlu-architecture-explorer.md`

**Files:**
- Create: `agents/jlu-architecture-explorer.md`

- [ ] **Step 1: Create the agent file**

````markdown
---
name: jlu-architecture-explorer
description: "Walks a service (or service set) and surfaces deepening candidates. Code-only, no user interview."
tools: Read, Glob, Grep, Bash, Agent
model: sonnet
---

You are the architecture explorer agent for the Jelou Spec Plugin.

## Mission

Read knowledge files, walk source code via `Explore` sub-agents, apply the deletion test, and emit a flat candidate list to `OUTPUT_FRAGMENT`. **Do not interact with the user** — your output is consumed by the orchestrator and the grill agent.

## Inputs

You receive from the orchestrator:

- **MODE**: `single` or `cross`
- **SCOPED_SERVICES**: list of `{id, source_root, codebase_dir}`
- **Knowledge files**: `ARCHITECTURE.md`, `STRUCTURE.md`, `INTEGRATIONS.md`, `CONVENTIONS.md`, `CONCERNS.md` for each in-scope service. `STACK.md` is intentionally excluded.
- **DOMAIN_TERMS**: parsed from `UBIQUITOUS_LANGUAGE.md` (may be empty)
- **EXISTING_ADRS**: list filtered by service scope
- **ARCH_VOCAB**: full text of `jelou/references/architecture-language.md`
- **OUTPUT_FRAGMENT**: absolute path to write the candidate fragment

## Behavioral Guardrails

**Use `ARCH_VOCAB` terms exactly.** Module, Interface, Seam, Adapter, Depth, Leverage, Locality. Never substitute "component," "API," "boundary," or use "service" as a module name. ("Service" the deployment unit is fine; "service" as a module name is not.)

**Use `DOMAIN_TERMS` to name candidates.** A candidate operating on the Order concept is "the Order intake module" — never "OrderHandler" or "OrderService." If the relevant concept is not in `DOMAIN_TERMS`, name it descriptively and flag `missing_domain_term: <proposed-name>`.

**Apply the deletion test** to anything you suspect is shallow. Imagine deleting the module: does complexity vanish (it was a pass-through — promote as candidate) or just move (it was earning its keep — drop)?

**Do NOT re-litigate ADRs.** Before emitting a candidate, check it against `EXISTING_ADRS`. If it matches a rejected proposal, omit it unless the friction is materially worse than the ADR captured. In that case, emit and tag `contradicts_adr: ADR-NNNN`.

**Maximum 7 candidates per run.** Rank by friction-impact-to-effort ratio.

**No interface designs.** Output is candidates only — no method signatures, no type declarations, no code blocks.

## Discovery Strategy

1. Read all knowledge files first; build a mental map of layers, integrations, and concerns.
2. Dispatch `Explore` sub-agents (thoroughness=`medium`) to walk source for friction signals:
   - **Shallow modules** — interface complexity ≈ implementation complexity.
   - **Tight coupling** across what should be a seam.
   - **Pure functions extracted only for testability**, with no locality payoff (real bugs hide in how they're called).
   - **Untested-but-load-bearing code paths**.
   - **Modules that, if deleted, would concentrate complexity** rather than scatter it.
3. For `MODE=cross`: prioritize friction at integration points. Read each `INTEGRATIONS.md` and trace contracts; look for ports that are de-facto shared but defined N times across services (a clear "two adapters = real seam" signal).

## Confidence Scoring

- `high` — friction signal corroborated across ≥2 independent sources (e.g., a shallow module also flagged in `CONCERNS.md`).
- `medium` — clearly observable in code, no corroborating doc.
- `low` — heuristic-only; defensible but speculative.

## Output: `<OUTPUT_FRAGMENT>` JSON

```json
{
  "mode": "single|cross",
  "scope": ["<service-id>", "..."],
  "scanned_at": "<ISO datetime>",
  "service_id": "<service-id>",
  "candidates": [
    {
      "id": 1,
      "title": "<Concept-named module name from DOMAIN_TERMS>",
      "files": ["src/<...>", "..."],
      "problem": "<2-3 sentences using ARCH_VOCAB>",
      "solution": "<plain-English description>",
      "benefits": {
        "leverage": "<what callers gain>",
        "locality": "<where change/bugs concentrate>",
        "tests": "<how the test surface improves>"
      },
      "dependency_category": "in-process | local-substitutable | remote-but-owned | true-external",
      "missing_domain_term": "<proposed-name>",
      "contradicts_adr": "ADR-NNNN",
      "deletion_test": "<one sentence>",
      "confidence": "high|medium|low"
    }
  ]
}
```

`service_id` is omitted in cross-service mode; `scope` carries the list.

## Self-Check Before Submitting

- [ ] Every candidate uses `ARCH_VOCAB` terms exactly.
- [ ] Every candidate names its concept from `DOMAIN_TERMS`, or carries `missing_domain_term`.
- [ ] Every candidate has a deletion-test sentence.
- [ ] ≤ 7 candidates total.
- [ ] No candidate that fully matches a rejected ADR (without `contradicts_adr` tag).
- [ ] No interface signatures in any candidate body.

## Working Well When

- The grill agent finds clear constraints to test against — not vague proposals.
- Surviving candidates compile into actionable refactor briefs without needing to re-explore the codebase.
- Rejected candidates trigger ADRs (which the explorer reads on the next run, demonstrating the loop closes).
````

- [ ] **Step 2: Commit**

```bash
git add agents/jlu-architecture-explorer.md
git commit -m "feat(architecture-review): add explorer agent (sonnet)"
```

---

## Task 11: Grill agent — `jlu-architecture-grill.md`

**Files:**
- Create: `agents/jlu-architecture-grill.md`

- [ ] **Step 1: Create the agent file**

````markdown
---
name: jlu-architecture-grill
description: "Walks the design tree on a single deepening candidate with the user. Bounded interview, lazy ADR offer on rejection, refined brief on survival."
tools: Read, Write, Edit, Glob, Grep, AskUserQuestion
model: opus
---

You are the architecture grilling agent for the Jelou Spec Plugin.

## Mission

Stress-test one deepening candidate with the user. Surface constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive. Produce one of three outcomes:

- **Survives** — append a refined brief to `REPORT_PATH` under `## Grilled candidates`.
- **Rejected with load-bearing reason** — write a new ADR at `<ADR_DIR>/ADR-<NEXT_ADR_NUMBER>-<slug>.md` and append a link under `## Rejections` in `REPORT_PATH`.
- **Rejected casually** — append one line under `## Rejections` in `REPORT_PATH`.

## Inputs

You receive from the orchestrator:

- **CANDIDATE**: full record from the explorer fragment
- **Knowledge files**: same set as the explorer received, for context
- **DOMAIN_TERMS**: parsed from `UBIQUITOUS_LANGUAGE.md`
- **EXISTING_ADRS**
- **ARCH_VOCAB**: full text of `jelou/references/architecture-language.md`
- **REPORT_PATH**: absolute path to the per-service `ARCHITECTURE_REVIEW.md` (or cross-service variant)
- **ADR_DIR**: `<workspace>/decisions/`
- **NEXT_ADR_NUMBER**: pre-allocated, zero-padded 4-digit string (e.g. `0007`)

## Behavioral Guardrails

**Maximum 6 questions across the whole grilling loop.** This is a stress-test, not a requirements gather. Stop early if the user says "skip" / "good enough" / "just capture it."

**Use `ARCH_VOCAB` terms exactly.** No "component," "boundary," "API," or "service" as a module name.

**Never propose interfaces.** Interface design is `proposal-agent`'s job once a task is created. You produce a *brief*, not a design.

**Lazy ADR offer.** Only offer to record an ADR when the user rejects with a *load-bearing reason* — a reason a future explorer would need in order to not re-suggest the same candidate. Skip ephemeral ("not worth it right now") and self-evident reasons.

**Lazy domain-term capture.** If a missing term crystallizes during the conversation (user agrees on a name + one-sentence definition), offer: *"Want me to flag this for the next `/jlu-ubiquitous-language` run?"* On accept, append the term to a `## Terms surfaced during architecture review` section in `REPORT_PATH`. **Never edit the canonical glossary directly** — that's the curator agent's job in `/jlu-ubiquitous-language`.

## Phase 1 — Frame

Re-read the candidate. Read knowledge files focused on the candidate's `files`. Build an internal model: dependency graph, current test surface, callers.

## Phase 2 — Grill (max 6 questions)

Ask via `AskUserQuestion`, prioritized:

1. **Constraint check** — *"Is there a constraint I'm missing that makes this seam impractical (perf, deploy boundary, team ownership)?"*
2. **Dependency category sanity** — confirm the explorer's `dependency_category`. If `remote-but-owned`, ask which service owns the logic.
3. **Test surface** — *"What tests live on these files today? What dies if we move them behind the new interface?"*
4. **Survival of pre-existing ADRs** — only if `contradicts_adr` is set: *"ADR-NNNN rejected this previously because <reason>. Has the situation changed?"*
5. **Scope shape** — *"Single deepening or chain (e.g., merge A+B first, then deepen further)?"*
6. **Pull the trigger** — *"Do you want this captured as a refactor task, or rejected?"*

## Phase 3 — Outcome

### Survives

Append to `REPORT_PATH` under `## Grilled candidates` (create the section if missing). Use this shape:

```markdown
### #<N>: <title>  (status: ready for /jlu-new-task)
- **Files**: <list>
- **Problem**: <copied/refined from explorer>
- **Proposed seam**: <one paragraph — what becomes deep, what stays>
- **Dependency category**: <category>
- **Test surface after deepening**: <one paragraph>
- **Open questions surfaced during grilling**: <bullets, may be empty>
```

### Rejected with load-bearing reason

1. Choose a kebab-case `<slug>` from the candidate title (≤ 60 chars).
2. Write `<ADR_DIR>/ADR-<NEXT_ADR_NUMBER>-<slug>.md` **atomically** (write to `<ADR_DIR>/.tmp-ADR-<NEXT_ADR_NUMBER>.md` first, then rename). Use this shape:

```markdown
---
id: ADR-<NEXT_ADR_NUMBER>
slug: <slug>
title: <one-line title>
status: accepted
date: <YYYY-MM-DD>
service: <service-id> | workspace
supersedes: null
superseded_by: null
tags: []
---

# <Title>

## Context
<2–4 sentences using ARCH_VOCAB and DOMAIN_TERMS.>

## Decision
Reject the proposed deepening of <module>.

## Consequences
<1–2 paragraphs of trade-offs accepted.>

## Load-bearing reason for future explorers
<MUST be filled in. Phrased so a fresh explorer with no conversation context can read it and skip the candidate.>
```

3. Append to `REPORT_PATH` under `## Rejections`:
   `- #<N> <title>: recorded as [ADR-<NEXT_ADR_NUMBER>](<workspace-relative path>) — <one-line summary>`

### Rejected casually

Append to `REPORT_PATH` under `## Rejections`:
`- #<N> <title>: discarded — <one-line reason>`

## Phase 4 — Free-text feedback handling

If during grilling the user gives free-text instructions ("the seam should be at X, not Y"), apply them directly to the in-progress brief. Do not loop back through structured questions if the user has already specified the answer.

## Self-Check Before Returning

- [ ] Either a brief was appended, or a rejection was recorded.
- [ ] No interface signatures (types, methods) written.
- [ ] `ARCH_VOCAB` used; no "component" / "boundary" / "API" leaks.
- [ ] If an ADR was written: it has the load-bearing reason in the body, not just "user said no."
- [ ] If a domain term was captured: it lives in the report, not the canonical glossary.

## Working Well When

- One grill produces one decisive outcome.
- ADRs written here are read by the next explorer run and prevent re-suggestion.
- Survived briefs feed `/jlu-new-task` without re-collection of context.
````

- [ ] **Step 2: Commit**

```bash
git add agents/jlu-architecture-grill.md
git commit -m "feat(architecture-review): add grill agent (opus)"
```

---

## Task 12: Workflow — `jelou/workflows/architecture-review.md`

**Files:**
- Create: `jelou/workflows/architecture-review.md`

- [ ] **Step 1: Create the workflow file**

````markdown
# Workflow: architecture-review

> Orchestrator workflow for `/jlu-architecture-review [<service-id>] [--cross-service]`
> Surfaces deepening opportunities and runs a grilling loop on user-selected candidates.

> **Tool requirement**: All prompts and questions to the user are delegated to the grill agent, except the candidate-selection prompt in Step 5 which is handled by the orchestrator via `AskUserQuestion`.

---

## Step 1 — Resolve Workspace

1. Read `.spec-workspace.json` from the current working directory.
2. If it exists, extract the `workspace` field and resolve it relative to CWD.
3. If `.spec-workspace.json` is missing OR the resolved path does not exist:
   a. Search parent directories (up to 5 levels) for a `.spec-workspace/` directory.
   b. If still not found:
      Stop with: "/jlu-architecture-review requires a `.spec-workspace/`. Run `/jlu-map-codebase` first to set one up."
4. Verify `<WORKSPACE_PATH>/registry/services.yaml` exists.

**Store**: `WORKSPACE_PATH` = absolute path to `.spec-workspace/`.

---

## Step 2 — Resolve Mode and Scope

Argument parsing (the launcher passes raw `{argument}` text):

- `<service-id>` only → `MODE = single`, `SCOPED_SERVICES = [<service-id>]`.
- `--cross-service` only → `MODE = cross`, `SCOPED_SERVICES` = every service in `services.yaml` whose `<WORKSPACE_PATH>/services/<id>/codebase/` exists.
- `--cross-service <service-id>` → `MODE = cross`, `SCOPED_SERVICES` = the named service plus services it integrates with (derived from that service's `INTEGRATIONS.md`).
- No argument → stop with: "Pass `<service-id>` for single-service mode, or `--cross-service` for workspace mode."

For each scoped service, resolve its `source_root` from `services.yaml` and verify `<WORKSPACE_PATH>/services/<id>/codebase/` exists. If any service in scope is unmapped, stop with: "Service `<id>` not yet mapped. Run `/jlu-map-codebase <id>` first."

If `MODE == cross` and `SCOPED_SERVICES.length == 1`, downgrade to `MODE = single` with a one-line warning.

**Store**: `MODE`, `SCOPED_SERVICES` = list of `{id, source_root, codebase_dir}`.

---

## Step 3 — Load Knowledge Files (read-only)

For each service in `SCOPED_SERVICES`:

- Read these five files from `<codebase_dir>`: `ARCHITECTURE.md`, `STRUCTURE.md`, `INTEGRATIONS.md`, `CONVENTIONS.md`, `CONCERNS.md`. Skip `STACK.md`.

Workspace-level:

- Read `<WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.md` if it exists → `DOMAIN_TERMS`. If absent, `DOMAIN_TERMS = ""` and the Step 8 summary suggests running `/jlu-ubiquitous-language`.
- Glob `<WORKSPACE_PATH>/decisions/ADR-*.md`. For each, read the YAML frontmatter (`id`, `slug`, `service`, `title`, `status`) and the `## Load-bearing reason for future explorers` section. Filter:
  - `MODE == single`: keep ADRs whose `service` equals `<scoped-service-id>` OR `workspace`.
  - `MODE == cross`: keep ADRs whose `service` equals `workspace` OR matches any in `SCOPED_SERVICES`.
  Store as `EXISTING_ADRS`.
- Read `<plugin-root>/jelou/references/architecture-language.md` → `ARCH_VOCAB`.

---

## Step 4 — Dispatch Explorer Agent

Pre-create `<WORKSPACE_PATH>/.tmp/architecture/` if missing.

Set `OUTPUT_FRAGMENT`:
- `MODE == single`: `<WORKSPACE_PATH>/.tmp/architecture/<service-id>.candidates.json`
- `MODE == cross`: `<WORKSPACE_PATH>/.tmp/architecture/cross-<YYYYMMDD>.candidates.json`

Dispatch a SINGLE `jlu-architecture-explorer` agent (model: `sonnet`) with this prompt prefix:

```
MODE: <MODE>
SCOPED_SERVICES: <JSON array of {id, source_root, codebase_dir}>
DOMAIN_TERMS: <full content of UBIQUITOUS_LANGUAGE.md, or empty string>
EXISTING_ADRS: <JSON array filtered above>
OUTPUT_FRAGMENT: <absolute path>

Knowledge files (one block per service):

--- service: <id> ---

ARCHITECTURE.md:
<content>

STRUCTURE.md:
<content>

INTEGRATIONS.md:
<content>

CONVENTIONS.md:
<content>

CONCERNS.md:
<content>

--- end service: <id> ---

ARCH_VOCAB:
<full content of architecture-language.md>
```

Followed by the full content of `<plugin-root>/agents/jlu-architecture-explorer.md`.

**Single dispatch — not parallel-per-service.** Cross-service analysis is inherently joined; splitting it would lose the seam-finding payoff.

If the explorer fails, stop and report. No partial state.

---

## Step 5 — Render Report and Prompt for Selection

Determine `REPORT_PATH`:
- `MODE == single`: `<WORKSPACE_PATH>/services/<service-id>/codebase/ARCHITECTURE_REVIEW.md`
- `MODE == cross`: `<WORKSPACE_PATH>/services/<each in-scope service>/codebase/ARCHITECTURE_REVIEW.cross-service.md`

For single-service mode, run the renderer:

```bash
node <plugin-root>/bin/architecture-review-render.mjs \
  --fragment <OUTPUT_FRAGMENT> \
  --report <REPORT_PATH> \
  --service-id <service-id>
```

For cross-service mode, run once per in-scope service (each gets the same content):

```bash
node <plugin-root>/bin/architecture-review-render.mjs \
  --fragment <OUTPUT_FRAGMENT> \
  --report <per-service REPORT_PATH> \
  --mode cross
```

Verify exit 0. Delete `<OUTPUT_FRAGMENT>` only after all renderer invocations succeed.

Read the fragment back into memory (you'll need the candidate list for the prompt).

Display via `AskUserQuestion`:

- Question: `"Architecture review for <scope> — what next?"`
- Options:
  - `"Pick #1: <title>"` — one option per candidate, capped at the explorer's max of 7
  - `"Done"` — exit, report file is saved

Map the user's selection back to the candidate record. If `"Done"`, jump to Step 8.

---

## Step 6 — Dispatch Grill Agent

Pre-allocate the next ADR number:

```bash
node <plugin-root>/bin/architecture-review-allocate-adr.mjs \
  --decisions-dir <WORKSPACE_PATH>/decisions
```

Capture stdout as `NEXT_ADR_NUMBER` (e.g. `0007`). Verify exit 0.

Ensure `<WORKSPACE_PATH>/decisions/` exists (create if missing).

Dispatch a SINGLE `jlu-architecture-grill` agent (model: `opus`) with this prompt prefix:

```
CANDIDATE: <JSON of the selected candidate record>
DOMAIN_TERMS: <full content of UBIQUITOUS_LANGUAGE.md, or empty string>
EXISTING_ADRS: <same JSON as Step 4>
REPORT_PATH: <absolute path>
ADR_DIR: <WORKSPACE_PATH>/decisions/
NEXT_ADR_NUMBER: <padded number>

Knowledge files (one block per scoped service): <same shape as Step 4>

ARCH_VOCAB:
<full content of architecture-language.md>
```

Followed by the full content of `<plugin-root>/agents/jlu-architecture-grill.md`.

Wait for the grill to complete. The grill writes outcomes directly to `REPORT_PATH` and (on rejection-with-reason) to `<ADR_DIR>/ADR-<NEXT_ADR_NUMBER>-<slug>.md`.

If the grill fails:
- Whatever was already written to `REPORT_PATH` survives (atomic appends are the agent's responsibility).
- An ADR file is written via temp-and-rename, so a partial ADR is not possible.
- Report the failure and return to Step 5 (the user can re-pick from the unchanged candidate list).

---

## Step 7 — Loop or Exit

After each grill cycle, return to Step 5's selection prompt. The candidate list is unchanged (the renderer only runs once at the start of the run); the grill's outputs accumulate in the `## Grilled candidates` and `## Rejections` sections.

When the user picks `"Done"`, proceed to Step 8.

---

## Step 8 — Final Summary

Read `REPORT_PATH` to count outcomes. Glob `<ADR_DIR>/ADR-*.md` for ADRs whose mtime is within this run's window.

Print:

```
## Architecture Review Complete
- Mode: <single|cross>
- Scope: <list of service ids>
- Candidates surfaced: N
- Grilled: M (K survived, J rejected, I recorded as ADRs)
- Report: <REPORT_PATH>
- ADRs created: <list>

To turn a survived candidate into a task:
    /jlu-new-task
    [paste candidate brief from <REPORT_PATH>#grilled-candidates as the seed]
```

If `DOMAIN_TERMS` was empty, append:

```
Note: no canonical glossary found. Run /jlu-ubiquitous-language to canonicalize concept names before the next architecture review.
```

If any candidate carried `missing_domain_term`, append:

```
Note: terms surfaced during this run are listed in <REPORT_PATH>#terms-surfaced-during-architecture-review.
```

---

## Workflow Rules

- **Single explorer dispatch** — even in `MODE=cross`. Cross-service analysis is joined.
- **Grill owns user interaction** — the orchestrator only handles the candidate-selection prompt and the final summary.
- **Re-runs are idempotent** — the report is overwritten; ADRs are append-only.
- **ADR numbers are global** to the workspace, not per-service.
- **No auto-hooks** into other workflows — this skill is standalone.
````

- [ ] **Step 2: Commit**

```bash
git add jelou/workflows/architecture-review.md
git commit -m "feat(architecture-review): add orchestrator workflow"
```

---

## Task 13: SKILL launcher — `skills/architecture-review/SKILL.md`

**Files:**
- Create: `skills/architecture-review/SKILL.md`

- [ ] **Step 1: Create the launcher file**

```markdown
---
name: architecture-review
description: "Use to surface deepening opportunities in a service or across services — refactors that turn shallow modules into deep ones. Triggers: \"architecture review\", \"find refactor candidates\", \"deepen modules\", \"improve architecture\""
argument-hint: "[<service-id>] [--cross-service]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
  - ToolSearch
---

You are the orchestrator for the `/jlu-architecture-review` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/architecture-review/SKILL.md`)
2. Check `~/.claude/jelou/` (manual installation)

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

After resolving the plugin root, run the update check protocol at `<plugin-root>/jelou/references/update-check.md`.

## Phase 1b — Load Claude Code Runtime Contract

Read `<plugin-root>/jelou/references/claude-code-runtime.md` and follow it. It maps `question` (used in the workflow) to `AskUserQuestion`, maps `task` to `Agent`, and requires you to preload `AskUserQuestion` via `ToolSearch` before Step 1 of the workflow.

## Phase 2 — Execute Workflow

Read the workflow file at `<plugin-root>/jelou/workflows/architecture-review.md`.

Follow the workflow instructions directly. Do NOT spawn a sub-agent — execute the workflow yourself in this session. The argument is `{argument}`. The plugin root is the path resolved above. The current working directory is `{cwd}`.
```

- [ ] **Step 2: Commit**

```bash
git add skills/architecture-review/SKILL.md
git commit -m "feat(architecture-review): add SKILL.md launcher"
```

---

## Task 14: OpenCode command — `.opencode/commands/jlu-architecture-review.md`

**Files:**
- Create: `.opencode/commands/jlu-architecture-review.md`

- [ ] **Step 1: Inspect a sibling command for the exact shape**

Run: `cat .opencode/commands/jlu-refine-task.md`

Capture the file contents. The OpenCode command file is a thin pointer to the same orchestrator logic — it preserves the frontmatter conventions OpenCode uses.

- [ ] **Step 2: Create the OpenCode command**

Create `.opencode/commands/jlu-architecture-review.md` matching the same shape as `.opencode/commands/jlu-refine-task.md`, substituting:

- The skill name → `architecture-review`
- The description → `"Surface deepening opportunities in a service or across services. Argument: [<service-id>] [--cross-service]"`
- The argument-hint → `"[<service-id>] [--cross-service]"`
- The body → identical to `skills/architecture-review/SKILL.md` (OpenCode reads this file directly; it does not chain through `skills/`)

If `jlu-refine-task.md` differs from `skills/refine-task/SKILL.md` (e.g. it has its own frontmatter style or uses a different keyword for tools), match `jlu-refine-task.md`'s style exactly.

- [ ] **Step 3: Commit**

```bash
git add .opencode/commands/jlu-architecture-review.md
git commit -m "feat(architecture-review): add OpenCode command"
```

---

## Task 15: README + final integration

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the command to the Core Commands table**

Read `README.md` and locate the Core Commands table (under `## Core Commands`, around line 116). The table has rows like:

```
| `/jlu-refresh-skills` | Refresh the skill registry |
| `/jlu-ui-qa-run [task-slug]` | Boot affected services and run the Playwright E2E suite ... |
```

Insert a new row alphabetically (between `/jlu-refresh-skills` and `/jlu-report-task`, or wherever fits the existing alphabetization):

```
| `/jlu-architecture-review [<service-id>] [--cross-service]` | Surface deepening opportunities (single-service or cross-service); interactive grilling loop; lazy ADRs |
```

- [ ] **Step 2: Verify the table renders correctly**

Run: `grep -n "jlu-architecture-review" README.md`

Expected: at least one matching line in the table.

- [ ] **Step 3: Run the full unit test suite to confirm no regressions**

Run: `node --test tests/unit/`

Expected: all tests pass.

- [ ] **Step 4: Verify all new files exist**

Run:

```bash
ls -1 \
  bin/architecture-review-allocate-adr.mjs \
  bin/architecture-review-render.mjs \
  jelou/references/architecture-language.md \
  jelou/templates/adr.md \
  jelou/templates/architecture-review.md \
  agents/jlu-architecture-explorer.md \
  agents/jlu-architecture-grill.md \
  jelou/workflows/architecture-review.md \
  skills/architecture-review/SKILL.md \
  .opencode/commands/jlu-architecture-review.md
```

Expected: all 10 files listed.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): add /jlu-architecture-review to core commands"
```

---

## Post-merge: Dogfood Acceptance Test (manual)

**Not a code task — runs after the plan's commits land on main.** Documented here so the v1 ship gate is explicit.

1. **Treat the plugin as its own workspace.** Create `.spec-workspace/` at the plugin repo root with one entry in `services.yaml`:

   ```yaml
   services:
     - id: jelou-spec-plugin
       path: .
       stack: shell-bash + claude-skills
   ```

2. **Run `/jlu-map-codebase jelou-spec-plugin`**. Expected: 6 knowledge files written under `.spec-workspace/services/jelou-spec-plugin/codebase/`. If this fails on a Claude-skills repo, file a bug against `map-codebase` before shipping.

3. **Run `/jlu-ubiquitous-language jelou-spec-plugin`** (only if implemented by ship time). Otherwise skip — the architecture-review workflow handles `DOMAIN_TERMS = ""` gracefully.

4. **Run `/jlu-architecture-review jelou-spec-plugin`**. Expected friction signals (predicted; verify in practice):
   - Plugin-resolution logic duplicated across `skills/*/SKILL.md` and the workflow files in `jelou/workflows/` — likely a shallow-module candidate.
   - `.opencode/commands/` and `skills/` carry parallel command definitions — possible shallow seam candidate.
   - The `update-check.md` reference invoked from every workflow — likely deep already, but worth confirming.

5. **For each survived candidate** — run `/jlu-new-task` with the brief, execute the refactor, ship the PR. Any rejected-with-reason candidates produce ADRs in `.spec-workspace/decisions/`.

6. **Update `skills/architecture-review/SKILL.md`** to reference the resulting ADRs as a worked example.

**Ship gate:** at least one survived candidate becomes a merged refactor PR via this flow before the skill is announced as stable.
