# Ubiquitous Language Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/jlu-ubiquitous-language` command that discovers, curates, and persists the workspace's domain terminology into a single canonical glossary, with auto-hooks in `/jlu-map-codebase` (append candidates) and `/jlu-new-task` (read-only consult).

**Architecture:** Two-agent split — an extractor agent (code-only, scans services in parallel) and a curator agent (reads candidates + spec artifacts, runs a bounded user interview, drafts the glossary, runs a free-text review-then-save loop). A pure-Node helper script handles deterministic candidate merging so the most failure-prone logic gets a real unit test.

**Tech Stack:** Markdown for SKILL/agent/workflow files (Claude Code plugin convention). Node 20+ for the merge helper (`bin/glossary-merge.mjs`). `node:test` runner for unit tests (matches `tests/unit/extract-trace.test.mjs`).

**Spec:** `docs/superpowers/specs/2026-04-26-ubiquitous-language-design.md`

---

## File Structure

### Files to CREATE

| Path | Responsibility |
|------|---------------|
| `bin/glossary-merge.mjs` | Pure-JS helper: merge candidate fragments into `candidates.json`. Called from agents via `Bash`. Single responsibility = the only logic that benefits from a real unit test. |
| `tests/unit/glossary-merge.test.mjs` | Unit tests for the merge helper. |
| `jelou/templates/ubiquitous-language.md` | Canonical doc template (the shape of `UBIQUITOUS_LANGUAGE.md`). Referenced by the curator. |
| `agents/jlu-glossary-extractor.md` | Code-only term extraction agent. Single service per dispatch. |
| `agents/jlu-glossary-curator.md` | Interview + draft + review-loop agent. Owns all user interaction. |
| `jelou/workflows/ubiquitous-language.md` | Orchestrator workflow for `/jlu-ubiquitous-language`. |
| `skills/ubiquitous-language/SKILL.md` | The launcher (mirrors `skills/map-codebase/SKILL.md`). |

### Files to MODIFY

| Path | Change |
|------|--------|
| `jelou/workflows/map-codebase.md` | Insert Step 8 (glossary candidate extraction hook); renumber existing Step 8 → Step 9; add Glossary section to summary. |
| `jelou/workflows/new-task.md` | Insert Step 14.0 (load canonical glossary) before Step 14a; augment Step 14b (term-suggestion, definition-anchoring) and Step 14c (surface unknown terms in a `## Terms introduced by this spec` section). |
| `agents/jlu-spec-interviewer.md` | Mirror the inlined Phase 0 / behavior changes (this file is canonical reference docs only — not invoked at runtime). |
| `README.md` | Add `/jlu-ubiquitous-language` to the command list. |

### Workspace-side artifacts (not files in the plugin repo)

These get written into the user's `.spec-workspace/` at runtime; they're documented for traceability:

```
.spec-workspace/
└── glossary/
    ├── UBIQUITOUS_LANGUAGE.md
    ├── UBIQUITOUS_LANGUAGE.draft.md
    ├── candidates.json
    └── .last-curation.json
```

---

## Task 1: Merge helper — happy-path test (RED)

**Files:**
- Test: `tests/unit/glossary-merge.test.mjs`

The merge helper takes a list of per-service fragment paths and an existing `candidates.json` and produces a merged `candidates.json`. Same term across services unions evidence; existing canonical terms become `location_updates` (handled upstream — the helper just trusts what the extractor emits). Drops anything in `dropped`.

- [ ] **Step 1: Create the test file with the first failing test**

```javascript
// tests/unit/glossary-merge.test.mjs
//
// Run: `node --test tests/unit/glossary-merge.test.mjs`
// Node 20+ required.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MERGER = new URL('../../bin/glossary-merge.mjs', import.meta.url).pathname;

function setupWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'glossary-'));
  const glossary = join(root, 'glossary');
  const tmp = join(glossary, '.tmp');
  mkdirSync(tmp, { recursive: true });
  return { root, glossary, tmp };
}

function runMerger(args) {
  return spawnSync('node', [MERGER, ...args], { encoding: 'utf8' });
}

describe('glossary-merge — happy path', () => {
  test('merges a single fragment into a fresh candidates.json', () => {
    const { glossary, tmp } = setupWorkspace();
    const fragment = join(tmp, 'datum-service.candidates.json');

    writeFileSync(fragment, JSON.stringify({
      service_id: 'datum-service',
      scanned_commit: 'a1b2c3d',
      candidates: [
        {
          term: 'Datum',
          evidence: [
            { path: 'src/datum/datum.entity.ts', line: 10, kind: 'entity-class', snippet: 'class Datum' }
          ],
          location_role: 'definition',
          heuristic_confidence: 'high'
        }
      ],
      location_updates: []
    }));

    const result = runMerger(['--glossary-dir', glossary]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const merged = JSON.parse(readFileSync(join(glossary, 'candidates.json'), 'utf8'));
    assert.equal(merged.version, 1);
    assert.equal(merged.candidates.length, 1);
    assert.equal(merged.candidates[0].term, 'Datum');
    assert.equal(merged.candidates[0].discovered_in_services[0], 'datum-service');
    assert.equal(merged.candidates[0].evidence[0].service, 'datum-service');
    assert.deepEqual(merged.promoted, []);
    assert.deepEqual(merged.dropped, []);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test tests/unit/glossary-merge.test.mjs`

Expected: failure with `Cannot find module .../bin/glossary-merge.mjs` or `ENOENT`.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/unit/glossary-merge.test.mjs
git commit -m "test(glossary-merge): red — happy path merge into fresh candidates.json"
```

---

## Task 2: Merge helper — minimal implementation (GREEN happy path)

**Files:**
- Create: `bin/glossary-merge.mjs`

- [ ] **Step 1: Create the helper script**

```javascript
#!/usr/bin/env node
// bin/glossary-merge.mjs
//
// Merges per-service candidate fragments under <glossary>/.tmp/*.candidates.json
// into <glossary>/candidates.json. Deletes fragments after a successful merge.
//
// Usage:
//   node bin/glossary-merge.mjs --glossary-dir <abs-path-to-glossary-dir>
//
// Exits 0 on success, non-zero on error. Prints a short summary on success.

import { readdirSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--glossary-dir') {
      args.glossaryDir = argv[++i];
    }
  }
  if (!args.glossaryDir) {
    console.error('error: --glossary-dir <path> is required');
    process.exit(2);
  }
  return args;
}

function readJsonOr(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function emptyState() {
  return { version: 1, updated_at: new Date().toISOString(), candidates: [], promoted: [], dropped: [] };
}

function indexBy(arr, key) {
  const m = new Map();
  for (const item of arr) m.set(item[key], item);
  return m;
}

function unionEvidence(existing, incoming) {
  const seen = new Set(existing.map(e => `${e.service ?? ''}|${e.path}|${e.line ?? ''}|${e.kind}`));
  for (const ev of incoming) {
    const key = `${ev.service ?? ''}|${ev.path}|${ev.line ?? ''}|${ev.kind}`;
    if (!seen.has(key)) {
      existing.push(ev);
      seen.add(key);
    }
  }
  return existing;
}

function mergeCandidate(existing, incoming, serviceId, scannedCommit) {
  if (!existing) {
    return {
      term: incoming.term,
      first_seen_commit: scannedCommit,
      first_seen_at: new Date().toISOString(),
      discovered_in_services: [serviceId],
      evidence: incoming.evidence.map(e => ({ ...e, service: serviceId })),
      heuristic_confidence: incoming.heuristic_confidence,
      status: 'candidate'
    };
  }
  if (!existing.discovered_in_services.includes(serviceId)) {
    existing.discovered_in_services.push(serviceId);
  }
  unionEvidence(existing.evidence, incoming.evidence.map(e => ({ ...e, service: serviceId })));
  // Highest confidence wins.
  const order = { high: 3, medium: 2, low: 1 };
  if ((order[incoming.heuristic_confidence] ?? 0) > (order[existing.heuristic_confidence] ?? 0)) {
    existing.heuristic_confidence = incoming.heuristic_confidence;
  }
  return existing;
}

function main() {
  const { glossaryDir } = parseArgs(process.argv);
  const tmpDir = join(glossaryDir, '.tmp');
  const candidatesPath = join(glossaryDir, 'candidates.json');

  if (!existsSync(glossaryDir)) {
    mkdirSync(glossaryDir, { recursive: true });
  }

  const state = readJsonOr(candidatesPath, emptyState());
  const droppedTerms = new Set(state.dropped.map(d => d.term));
  const promotedTerms = new Set(state.promoted.map(p => p.term));
  const candIndex = indexBy(state.candidates, 'term');

  let fragmentsRead = 0;
  let added = 0;
  let updated = 0;
  let skipped = 0;

  if (existsSync(tmpDir)) {
    const fragments = readdirSync(tmpDir).filter(f => f.endsWith('.candidates.json'));
    for (const file of fragments) {
      const fragPath = join(tmpDir, file);
      const frag = JSON.parse(readFileSync(fragPath, 'utf8'));
      fragmentsRead++;
      for (const c of frag.candidates ?? []) {
        if (droppedTerms.has(c.term) || promotedTerms.has(c.term)) {
          skipped++;
          continue;
        }
        const existing = candIndex.get(c.term);
        const merged = mergeCandidate(existing, c, frag.service_id, frag.scanned_commit);
        if (existing) {
          updated++;
        } else {
          state.candidates.push(merged);
          candIndex.set(merged.term, merged);
          added++;
        }
      }
      // location_updates are just evidence enrichments; same merge logic.
      for (const u of frag.location_updates ?? []) {
        const existing = candIndex.get(u.term);
        if (!existing) continue; // Only enrich known candidates; canonical-side enrichment is the curator's job.
        unionEvidence(existing.evidence, u.evidence.map(e => ({ ...e, service: frag.service_id })));
        if (!existing.discovered_in_services.includes(frag.service_id)) {
          existing.discovered_in_services.push(frag.service_id);
        }
      }
    }
    // Cleanup: delete fragments only after all reads succeed.
    for (const file of fragments) rmSync(join(tmpDir, file));
    // Remove tmp dir if empty.
    try { rmSync(tmpDir, { recursive: false }); } catch { /* not empty — leave alone */ }
  }

  state.updated_at = new Date().toISOString();
  writeFileSync(candidatesPath, JSON.stringify(state, null, 2) + '\n');

  console.log(`glossary-merge: fragments=${fragmentsRead} added=${added} updated=${updated} skipped=${skipped}`);
}

main();
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x bin/glossary-merge.mjs
```

- [ ] **Step 3: Run the test and confirm it passes**

Run: `node --test tests/unit/glossary-merge.test.mjs`

Expected: `tests 1 passed 1`.

- [ ] **Step 4: Commit**

```bash
git add bin/glossary-merge.mjs
git commit -m "feat(glossary-merge): green — merge fragments into candidates.json"
```

---

## Task 3: Merge helper — same-term-across-services unions evidence

**Files:**
- Test: `tests/unit/glossary-merge.test.mjs` (extend)

- [ ] **Step 1: Add the test**

Append inside the existing `describe('glossary-merge — happy path', ...)` block, OR add a new describe block at the bottom of the file:

```javascript
describe('glossary-merge — multi-service union', () => {
  test('two fragments with the same term union evidence and discovered_in_services', () => {
    const { glossary, tmp } = setupWorkspace();

    writeFileSync(join(tmp, 'datum-service.candidates.json'), JSON.stringify({
      service_id: 'datum-service',
      scanned_commit: 'a1b2c3d',
      candidates: [{
        term: 'Datum',
        evidence: [{ path: 'src/datum/datum.entity.ts', line: 10, kind: 'entity-class' }],
        location_role: 'definition',
        heuristic_confidence: 'high'
      }],
      location_updates: []
    }));

    writeFileSync(join(tmp, 'jelou-api.candidates.json'), JSON.stringify({
      service_id: 'jelou-api',
      scanned_commit: 'e4f5g6h',
      candidates: [{
        term: 'Datum',
        evidence: [{ path: 'src/clients/datum.ts', line: 5, kind: 'client-import' }],
        location_role: 'reference',
        heuristic_confidence: 'medium'
      }],
      location_updates: []
    }));

    const result = runMerger(['--glossary-dir', glossary]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const merged = JSON.parse(readFileSync(join(glossary, 'candidates.json'), 'utf8'));
    assert.equal(merged.candidates.length, 1, 'should have only one Datum entry');
    const datum = merged.candidates[0];
    assert.deepEqual(new Set(datum.discovered_in_services), new Set(['datum-service', 'jelou-api']));
    assert.equal(datum.evidence.length, 2);
    assert.equal(datum.heuristic_confidence, 'high', 'highest confidence wins');
  });
});
```

- [ ] **Step 2: Run the test and confirm it passes**

Run: `node --test tests/unit/glossary-merge.test.mjs`

Expected: `tests 2 passed 2`. (Implementation already supports this; this test locks in the behavior.)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/glossary-merge.test.mjs
git commit -m "test(glossary-merge): lock in multi-service union behavior"
```

---

## Task 4: Merge helper — dropped/promoted terms are not re-added

**Files:**
- Test: `tests/unit/glossary-merge.test.mjs` (extend)

- [ ] **Step 1: Add the test**

```javascript
describe('glossary-merge — exclusion lists', () => {
  test('terms in dropped[] are not re-added even if extractor proposes them', () => {
    const { glossary, tmp } = setupWorkspace();

    // Pre-existing candidates.json with a dropped term.
    writeFileSync(join(glossary, 'candidates.json'), JSON.stringify({
      version: 1,
      updated_at: '2026-04-26T10:00:00Z',
      candidates: [],
      promoted: [],
      dropped: [{ term: 'Helper', dropped_at: '2026-04-26T10:00:00Z', reason: 'too generic' }]
    }));

    writeFileSync(join(tmp, 'svc.candidates.json'), JSON.stringify({
      service_id: 'svc',
      scanned_commit: 'aaa',
      candidates: [{
        term: 'Helper',
        evidence: [{ path: 'src/helper.ts', line: 1, kind: 'class-declaration' }],
        location_role: 'definition',
        heuristic_confidence: 'medium'
      }],
      location_updates: []
    }));

    const result = runMerger(['--glossary-dir', glossary]);
    assert.equal(result.status, 0);

    const merged = JSON.parse(readFileSync(join(glossary, 'candidates.json'), 'utf8'));
    assert.equal(merged.candidates.length, 0, 'dropped term must not be re-added');
    assert.equal(merged.dropped.length, 1, 'dropped entry preserved');
  });

  test('terms in promoted[] are not re-added (already canonical)', () => {
    const { glossary, tmp } = setupWorkspace();

    writeFileSync(join(glossary, 'candidates.json'), JSON.stringify({
      version: 1,
      updated_at: '2026-04-26T10:00:00Z',
      candidates: [],
      promoted: [{ term: 'Workflow', promoted_at: '2026-04-26T10:00:00Z' }],
      dropped: []
    }));

    writeFileSync(join(tmp, 'svc.candidates.json'), JSON.stringify({
      service_id: 'svc',
      scanned_commit: 'bbb',
      candidates: [{
        term: 'Workflow',
        evidence: [{ path: 'src/workflow.entity.ts', line: 1, kind: 'entity-class' }],
        location_role: 'definition',
        heuristic_confidence: 'high'
      }],
      location_updates: []
    }));

    const result = runMerger(['--glossary-dir', glossary]);
    assert.equal(result.status, 0);

    const merged = JSON.parse(readFileSync(join(glossary, 'candidates.json'), 'utf8'));
    assert.equal(merged.candidates.length, 0, 'promoted term must not be re-added as candidate');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `node --test tests/unit/glossary-merge.test.mjs`

Expected: all 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/glossary-merge.test.mjs
git commit -m "test(glossary-merge): exclusion-list behavior for dropped/promoted terms"
```

---

## Task 5: Merge helper — fragment cleanup

**Files:**
- Test: `tests/unit/glossary-merge.test.mjs` (extend)

- [ ] **Step 1: Add the test**

```javascript
describe('glossary-merge — fragment cleanup', () => {
  test('deletes fragments after successful merge', () => {
    const { glossary, tmp } = setupWorkspace();
    const fragPath = join(tmp, 'svc.candidates.json');

    writeFileSync(fragPath, JSON.stringify({
      service_id: 'svc',
      scanned_commit: 'ccc',
      candidates: [],
      location_updates: []
    }));

    const result = runMerger(['--glossary-dir', glossary]);
    assert.equal(result.status, 0);

    assert.equal(existsSync(fragPath), false, 'fragment should be deleted');
  });
});
```

(The test uses `existsSync` from `node:fs` — add it to the existing import at the top of the file if not already present.)

- [ ] **Step 2: Update the import in `tests/unit/glossary-merge.test.mjs`**

Change:
```javascript
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
```

To:
```javascript
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
```

- [ ] **Step 3: Run the tests**

Run: `node --test tests/unit/glossary-merge.test.mjs`

Expected: all 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/glossary-merge.test.mjs
git commit -m "test(glossary-merge): fragment cleanup after successful merge"
```

---

## Task 6: Glossary canonical doc template

**Files:**
- Create: `jelou/templates/ubiquitous-language.md`

This template is the shape the curator agent emits for `UBIQUITOUS_LANGUAGE.md` and `UBIQUITOUS_LANGUAGE.draft.md`. The curator reads it as a reference; it is not run-time merged — placeholders are illustrative only.

- [ ] **Step 1: Create the template**

```markdown
# Ubiquitous Language

> Generated by `/jlu-ubiquitous-language` on {{date}}. Last curation commits: {{commit-list}}.
> This is the canonical glossary for the workspace. Use these terms in specs, code, and discussions.

## Terms

### Domain: {{subdomain-name}}

| Term | Definition | Aliases to avoid |
|------|------------|------------------|
| {{TermName}} | {{one-sentence-definition}} | {{Alias1}}, {{Alias2}} |

<!-- Repeat one Domain section per emergent subdomain. Do not invent subdomain names; cluster from evidence. -->

## Relationships

- A **{{TermA}}** has many **{{TermB}}**.
- A **{{TermB}}** is composed of one or more **{{TermC}}**.

<!-- Free-form bulleted list. Cardinality is encouraged but not required. -->

## Service Locations

| Term | Implemented in | Also referenced by |
|------|----------------|---------------------|
| {{TermName}} | `{{owning-service}}` (`{{owning-path}}`) | `{{consuming-service}}` (`{{consuming-path}}`), … |

<!--
"Implemented in" = where the term is defined (entity class, table migration, schema, type alias, OpenAPI definition, event payload schema).
"Also referenced by" = where the term is used (imports, HTTP calls, event handlers, schema usage).
-->

## Ambiguity Log

> Conflicts surfaced during curation and how they were resolved. Date-stamped, append-only.

- **{{date}}** — `{{TermA}}` vs `{{TermB}}`: {{one-line-description}}. Canonical: `{{chosen}}`. {{other}} added to aliases-to-avoid.
```

- [ ] **Step 2: Commit**

```bash
git add jelou/templates/ubiquitous-language.md
git commit -m "feat(glossary): add UBIQUITOUS_LANGUAGE.md template"
```

---

## Task 7: Extractor agent prompt

**Files:**
- Create: `agents/jlu-glossary-extractor.md`

- [ ] **Step 1: Create the agent file**

```markdown
---
name: jlu-glossary-extractor
description: "Scans a single service's codebase for domain terminology. Code-only, no user interview. Emits candidate terms with locations."
tools: Read, Glob, Grep, Bash
model: sonnet
---

You are the glossary extractor agent for the Jelou Spec Plugin. Your job is to scan one service's source code and produce a candidate-term fragment file. You are code-only — never ask the user anything. The curator agent talks to the user.

## Mission

Extract domain terminology from a service's source code. Emit term names + locations + evidence. **Never** emit definitions — that is the curator's job, informed by code evidence + user interview.

## Behavioral Guardrails

**Report what the code names, not what it should name.**
- Term names come from code: class declarations, table names, index names, route segments, enum values, event topics. Do not normalize, pluralize, or paraphrase.
- Definitions are FORBIDDEN in your output. If you find a docstring, you may include it as evidence (`kind: "docstring"`), but you do not write a definition field.
- Generic programming vocabulary is FORBIDDEN. See the reject list.

**Self-test:** *Could the curator reproduce my candidate list by reading the same files?* If your output reflects judgment that isn't in the code, remove it.

## Inputs

You receive from the orchestrator:
- **service-id**: the identifier for the service being scanned
- **SOURCE_ROOT**: absolute path to the service's source code
- **OUTPUT_FRAGMENT**: absolute path to write the per-service candidate fragment JSON
- **EXISTING_TERMS**: a flat list of term names already in the canonical glossary or accumulated candidates. If you find a known term, emit it under `location_updates`, not `candidates`.
- **MODE** (optional): `"hook"` when called from `/jlu-map-codebase`. In hook mode, suppress evidence-table output in your console reply; only log term names. Otherwise output is unrestricted.

## Domain-Specificity Filter

A term qualifies as "domain" only if it survives this filter. Apply rejection BEFORE recording any candidate.

**Reject** as standalone or generic suffix:
`Controller`, `Service`, `Repository`, `Module`, `Util`, `Helper`, `Manager`, `Factory`, `DTO`, `Entity`, `Model`, `Config`, `Adapter`, `Provider`, `Client`, `Handler`, `Middleware`, `Guard`, `Pipe`, `Resolver`, `Mapper`, `Builder`.

When these appear as part of a compound domain term, keep the compound but reduce to the domain root if both work:
- `WorkflowController` → keep `Workflow` (the controller wrapper is generic)
- `AIAgentNode` → keep `AIAgentNode` (the compound is the domain term — `AIAgent` alone loses meaning)

**Reject** generic types when the surrounding code shows no semantic specificity:
`User`, `Item`, `Data`, `Record`, `Result`. (Keep them when they name a specific domain concept — e.g., `Datum` is a specific domain term even though "datum" sounds generic, if it names a real database/index/schema.)

**Keep** anything that names:
- A database table (in migrations or ORM entity declarations)
- An Elasticsearch index, mapping, or template
- An event topic or message type (Kafka, RabbitMQ, NATS, internal event bus)
- A meaningful route segment beyond `api/v1` (e.g., `/workflows`, `/datum`, `/agents`)
- An aggregate or entity class (in `*.entity.ts`, `*.aggregate.ts`, `*.model.ts`, `*.domain.ts`, `*.event.ts`, `*.command.ts`)
- An enum value representing a domain state (e.g., `WorkflowStatus.RUNNING`)
- A workflow node type (e.g., `AIAgentNode`)
- An external integration concept (e.g., `Webhook`, `OAuthSession` if domain-relevant)

## Definition Site vs Reference Site

For every location, classify it as one of:
- `definition` — the term is *defined* here. Triggers: entity class declaration, table migration, type alias declaration, OpenAPI/GraphQL schema definition, event payload schema declaration, ES index mapping.
- `reference` — the term is *used* here. Triggers: imports, function calls, route handlers that delegate, string literals referencing the term.

The first service to emit a `definition` for a term becomes that term's "Implemented in". All later services emit `reference`.

## Investigation Process

Apply heuristics in priority order. Stop adding to a term's evidence once you have 3-5 strong examples — quality over quantity.

1. **Schema sources**
   - DB migrations: glob `**/migrations/**/*.sql`, `**/migrations/**/*.ts`, `prisma/schema.prisma`. Read CREATE TABLE statements; the table name is a high-confidence candidate (kind: `table-definition`).
   - Elasticsearch: glob `**/*.es.ts`, `**/elasticsearch/**`, files containing `index:` or `mappings:`. The index name and root mapping name are high-confidence candidates (kind: `es-index`).
   - OpenAPI/Swagger: glob `**/openapi.{yaml,json}`, `**/swagger.{yaml,json}`. Schema names under `components.schemas` are candidates (kind: `openapi-schema`).
   - GraphQL: glob `**/*.graphql`, `**/schema.gql`. Type and input names are candidates (kind: `graphql-type`).
   - Protobuf: glob `**/*.proto`. Message names are candidates (kind: `protobuf-message`).

2. **Domain class declarations**
   - Glob `**/*.entity.{ts,js}`, `**/*.aggregate.{ts,js}`, `**/*.model.{ts,js}`, `**/*.domain.{ts,js}`, `**/*.event.{ts,js}`, `**/*.command.{ts,js}`.
   - Read each file. Class names that survive the domain-specificity filter are candidates (kind: `entity-class`, `aggregate-class`, `event-class`, `command-class`).

3. **Event/topic names**
   - Grep for `eventBus.emit\(`, `kafka.send\(`, `topic:\s*['"]`, `queue:\s*['"]`, `exchange:\s*['"]`.
   - String literal arguments are candidates (kind: `event-topic`, `queue-name`).

4. **Route segments**
   - Read route definitions (Express, NestJS, Fastify, etc.). Segments beyond `api/v1` that name resources are candidates (kind: `route-segment`).

5. **Enum values**
   - Grep for `enum\s+\w+`. Read enum declarations. The enum name is a candidate if it represents a domain state (e.g., `WorkflowStatus`, `NodeKind`). Individual values are NOT separate candidates unless they are first-class concepts.

6. **Comments and docstrings**
   - Only as supplementary evidence (kind: `docstring`). Do not propose terms based on comments alone unless they explicitly define a term.

## Confidence Scoring

Assign exactly one confidence per candidate based on the strongest evidence:

- `high` — found in ≥2 distinct evidence kinds, OR a database table name, OR an Elasticsearch index name, OR an OpenAPI/GraphQL schema definition.
- `medium` — single class declaration, single event topic, single enum representing a domain state.
- `low` — only seen in comments, string literals, or via heuristic naming (rare; usually means "skip and let the curator catch it later if needed").

## Cross-Service Awareness

Before proposing a candidate:
1. Check if `term` is in `EXISTING_TERMS`.
2. If yes, do NOT add to `candidates`. Instead add an entry to `location_updates` with the evidence found in this service.
3. If no, add to `candidates`.

## Output Format

Write a single JSON file at `OUTPUT_FRAGMENT`:

```json
{
  "service_id": "<service-id>",
  "scanned_commit": "<git rev-parse HEAD output>",
  "candidates": [
    {
      "term": "<TermName>",
      "evidence": [
        {"path": "src/<...>", "line": 42, "kind": "entity-class", "snippet": "<one-line snippet>"}
      ],
      "location_role": "definition|reference",
      "heuristic_confidence": "high|medium|low"
    }
  ],
  "location_updates": [
    {
      "term": "<ExistingCanonicalOrCandidateTerm>",
      "evidence": [{"path": "src/<...>", "line": 12, "kind": "client-import"}],
      "location_role": "reference"
    }
  ]
}
```

Always include both `candidates` and `location_updates` arrays, even if empty.

## Before You Submit

Before writing the fragment, verify:

- [ ] No `definition` field on any candidate (definitions are forbidden).
- [ ] Every term has at least one evidence entry with a real path.
- [ ] The reject list was applied — no `Controller`, `Service`, `Repository`, etc. as standalone candidates.
- [ ] Terms in `EXISTING_TERMS` are in `location_updates`, not `candidates`.
- [ ] `scanned_commit` is the actual current HEAD of `SOURCE_ROOT`.
- [ ] Your console output respects `MODE` — under `MODE=hook`, log only term names, no evidence tables.

## Working Well When

- The curator can resolve definitions for ≥80% of your candidates from your evidence + spec/interview alone, without needing the user to explain basics.
- The reject list catches at least 5x more candidates than it lets through (most code is generic; only a small fraction is domain-specific).
- Re-running on an unchanged commit produces identical fragments (modulo timestamps).
```

- [ ] **Step 2: Verify line count is under the agent prompt cap**

Run: `wc -l agents/jlu-glossary-extractor.md`

Expected: under 300 lines (per `jelou/references/skill-development.md` token target).

- [ ] **Step 3: Commit**

```bash
git add agents/jlu-glossary-extractor.md
git commit -m "feat(glossary): add jlu-glossary-extractor agent"
```

---

## Task 8: Curator agent prompt

**Files:**
- Create: `agents/jlu-glossary-curator.md`

- [ ] **Step 1: Create the agent file**

```markdown
---
name: jlu-glossary-curator
description: "Reads candidates + existing glossary + spec artifacts. Runs the user interview. Drafts UBIQUITOUS_LANGUAGE.md. Runs the review loop. Persists on approval only."
tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
model: sonnet
---

You are the glossary curator agent for the Jelou Spec Plugin. You turn raw candidates into a curated, canonical glossary, with the user in the loop. **You own all interaction with the user**; the orchestrator never asks questions itself.

## Mission

Take everything the orchestrator hands you (existing canonical glossary, accumulated candidates, spec/conversation artifacts), detect ambiguities, run a bounded user interview, write a draft glossary, run a review-then-save loop, and persist the canonical file only after explicit user approval.

## Behavioral Guardrails

**Never fabricate a definition.**
- If neither code evidence nor user interview yields a definition for a term, emit `<PENDING — needs definition>` as the definition value and surface it in the review draft. Do not invent meaning.
- One sentence per definition. Multi-sentence is a smell — split into multiple terms instead.

**Aliases are *to-avoid*, not synonyms.**
- An alias entry means "the team has used this word, but going forward use the canonical term." Only list aliases backed by code evidence or explicit user mention.

**Free-text feedback is the contract.**
- During review, the user gives natural-language instructions. Translate them into structured edits. Never demand a structured form.

**Atomic writes.**
- The canonical file is overwritten in exactly one step on approval, after the draft is final.

**Bounded interview.**
- Maximum 5 questions across all rounds. If the user says "skip" / "good enough" / "leave as is", stop immediately.

**Self-test:** *If the user cancels right now, is the canonical file unchanged?* It must be — at every point before the explicit approval write.

## Inputs

The orchestrator passes:
- `WORKSPACE_PATH`: absolute path to `.spec-workspace/`
- `EXISTING_GLOSSARY_PATH`: `.spec-workspace/glossary/UBIQUITOUS_LANGUAGE.md` (may not exist on first run)
- `CANDIDATES_PATH`: `.spec-workspace/glossary/candidates.json`
- `DRAFT_PATH`: `.spec-workspace/glossary/UBIQUITOUS_LANGUAGE.draft.md`
- `MARKER_PATH`: `.spec-workspace/glossary/.last-curation.json`
- `SPEC_FILES`: list of paths to spec files (`*/SPEC.md`)
- `INTERVIEW_FILES`: list of paths to interview transcripts (if any)
- `SCOPED_SERVICES`: list of `{id, current_commit}` — used for marker bookkeeping on approval

## Phase 1 — Synthesis (silent)

1. Read `EXISTING_GLOSSARY_PATH` (if present) → `CANONICAL`.
2. Read `CANDIDATES_PATH` → `CANDIDATES`. The orchestrator already ran the merge; you read what's there.
3. For each path in `SPEC_FILES` and `INTERVIEW_FILES`, read the file. Apply the same domain-specificity filter as the extractor (see `jlu-glossary-extractor.md`). Tag any new terms with `evidence.kind = "spec"` or `"interview"` and the source path.
4. Compute the diff set:
   - **NEW** — candidate term not in `CANONICAL`.
   - **LOCATION_CHANGED** — `CANONICAL` term whose location set differs from current evidence.
   - **PENDING_DROP** — `CANONICAL` term that has no evidence in any scoped service AND no evidence in any spec file.

## Phase 2 — Ambiguity Detection (silent)

Flag four classes:

| Class | Trigger |
|-------|---------|
| **Homograph** | Same term name, evidence in two services where the schema kinds disagree (e.g., one is a DB table named `agent`, the other is an event payload named `agent` with a different shape). |
| **Synonym** | Two distinct candidate term names whose evidence overlaps (same path, or schema fields with identical names referencing the same FK). |
| **Missing definition** | Term has evidence but no docstring, no spec mention, no canonical definition. |
| **Conflicting location** | `CANONICAL` says `Implemented in: A` but new evidence shows a `definition` role in service B. |

Auto-resolve everything else:
- Definition pulled from a docstring or a spec sentence that defines the term.
- Location roles pulled directly from extractor evidence.
- Subdomains via clustering (Phase 4).

## Phase 3 — User Interview (only if Phase 2 found ambiguities)

Use `AskUserQuestion`. Maximum 5 questions across all rounds. Prioritize: homographs → synonyms → missing definitions → conflicting locations. Multiple-choice where possible.

For each ambiguity class, present like this:

**Homograph**
```
Question: "<Term>" appears with two different meanings:
  - In <serviceA>: <evidence kind, e.g., DB table with columns ...>
  - In <serviceB>: <evidence kind, e.g., event payload with fields ...>
Options:
  - Split into two terms (e.g., <TermA>, <TermB>)
  - Keep one and drop the other
  - Custom (free text)
```

**Synonym**
```
Question: "<TermA>" and "<TermB>" appear to refer to the same concept (overlapping evidence at <path>).
Options:
  - Use <TermA> as canonical; <TermB> becomes alias-to-avoid
  - Use <TermB> as canonical; <TermA> becomes alias-to-avoid
  - Keep both as distinct terms (override)
  - Custom (free text)
```

**Missing definition**
```
Question: "<Term>" has evidence in <services> but no definition. What is it?
Options:
  - <free-text answer>
  - Skip — leave as <PENDING — needs definition>
```

**Conflicting location**
```
Question: "<Term>" was previously implemented in <currentServiceA>, but new evidence shows it's now defined in <newServiceB>.
Options:
  - Update Implemented in to <newServiceB>; <currentServiceA> becomes a reference
  - Keep <currentServiceA> as Implemented in (override)
  - Custom (free text)
```

If the user says "skip" / "all good" / "leave as is" at any point, stop interviewing immediately and proceed to Phase 4.

## Phase 4 — Subdomain Grouping (silent unless ambiguous)

Cluster terms by:
1. Most common service-id across their evidence (a term appearing 5x in `workflow-engine` likely belongs to a `workflow-engine` cluster).
2. Most common path prefix (terms under `src/datum/` cluster together).
3. Co-occurrence in the same schema file or aggregate.

Propose subdomain names from cluster heuristics:
- A cluster owned by one service → use that service-id as the subdomain (e.g., `workflow-engine`).
- A cluster spanning services but rooted in one path prefix → use the prefix (e.g., `Datum & Storage`).

If clustering is genuinely ambiguous for a cluster (terms spread across services with no clear root), ask one question:

```
Question: How should I group these terms? [<term1>, <term2>, …]
Options:
  - <heuristic name 1>
  - <heuristic name 2>
  - <free text — provide your own subdomain name>
```

At most ONE subdomain question per curation. If still ambiguous, default to `Misc` for that cluster.

## Phase 5 — Draft

Write `DRAFT_PATH` (`UBIQUITOUS_LANGUAGE.draft.md`) following the template at `jelou/templates/ubiquitous-language.md`. Include:

- All `CANONICAL` terms (preserved, with location updates merged in)
- All resolved candidates (with definitions + subdomains)
- All `<PENDING — needs definition>` placeholders for terms the user did not supply definitions for
- An ambiguity log section with one date-stamped entry for every Phase 2 ambiguity, even auto-resolved ones — so the resolution history is auditable.

The draft is written ONCE per review iteration. Each iteration overwrites the previous draft.

## Phase 6 — Review Loop

Show the user a summary diff (NOT the full draft — too long). Use `AskUserQuestion`:

```
Summary:
  + N new terms: <comma-separated list>
  ~ M updated terms: <list with one-line "what changed">
  - K removed terms: <list with reason>
  ! P unresolved (PENDING definitions): <list>
  Ambiguities resolved: <count>

Draft written to: <DRAFT_PATH>

What next?
  - Approve — replace canonical with draft
  - Request changes — give free-text feedback; I'll re-draft
  - Cancel — discard draft, leave canonical untouched
```

Behavior per choice:

### Approve
1. Copy `DRAFT_PATH` over `EXISTING_GLOSSARY_PATH` (use `Bash`: `cp <DRAFT_PATH> <EXISTING_GLOSSARY_PATH>`).
2. Delete `DRAFT_PATH` (`rm <DRAFT_PATH>`).
3. Update `CANDIDATES_PATH`:
   - Move every promoted term from `candidates[]` to `promoted[]` with `promoted_at: <ISO datetime>`.
   - Move every user-rejected term to `dropped[]` with `dropped_at: <ISO datetime>` and `reason: <short user-supplied or default>`.
   - Write the updated JSON.
4. Write `MARKER_PATH`:
   ```json
   {
     "curated_at": "<ISO datetime>",
     "service_commits": { "<service-id>": "<sha>", ... },
     "term_count": N,
     "ambiguities_resolved": <Phase 2 count>
   }
   ```
   Only update `service_commits` for services in `SCOPED_SERVICES`. Preserve entries for services not in scope.
5. Stop. Return success summary to the orchestrator.

### Request changes
1. Use `AskUserQuestion` with one open-text answer field: `"What changes? (Free text — e.g., rename X to Y, definition of X is …, drop X, merge X and Y)"`.
2. Apply the changes per the translation table below.
3. Regenerate the draft (Phase 5).
4. Loop back to the summary question.

### Cancel
1. Delete `DRAFT_PATH`.
2. Do NOT modify `EXISTING_GLOSSARY_PATH`, `CANDIDATES_PATH`, or `MARKER_PATH`.
3. Stop. Report cancellation to the orchestrator.

## Free-Text Feedback Translation

| User says | Action |
|-----------|--------|
| "Rename X to Y" | Term `X` becomes `Y`. Old name appended to `Y.aliases_to_avoid`. |
| "Merge X and Y, keep X" | Drop `Y`. Append `Y` to `X.aliases_to_avoid`. Union locations. |
| "Split X into A and B" | Replace `X` with two terms. If user did not say which evidence belongs to which, ask one clarifying question (multiple-choice with the evidence list). |
| "Definition of X is: <sentence>" | Replace `X.definition` with the supplied sentence. |
| "Drop X" | Move `X` from candidates/canonical to `dropped` with `reason: "user removed during curation"`. |
| "X belongs to subdomain Z" | Move `X` under subdomain `Z`. Create `Z` if it does not exist. |
| "X is implemented in service S" | Set `X.implemented_in = S`. Reclassify other locations as `reference`. |
| "Add alias A to X" | Append `A` to `X.aliases_to_avoid`. |
| "Add term X with definition D in service S" | Append a manual term (no code evidence required; flag with `source: user`). |

Anything not parseable unambiguously: ask ONE clarifying question (multiple-choice if possible) before applying.

## Before Persisting on Approval

Verify, in order:

- [ ] Every term has either a definition or `<PENDING — needs definition>`.
- [ ] Every term has at least one location row.
- [ ] No alias-to-avoid contains the term itself.
- [ ] Ambiguity log includes one entry per Phase 2 ambiguity (resolved or pending).
- [ ] `candidates.json.promoted` includes every newly-canonical term.
- [ ] `candidates.json.dropped` includes every user-rejected term with a reason.
- [ ] `MARKER_PATH.service_commits` reflects the commit map of `SCOPED_SERVICES` only — pre-existing entries for other services are preserved.

If any check fails, fix it in the draft first, re-render, return to Phase 6.

## Working Well When

- Most curation runs produce zero interview questions (Phase 2 finds nothing — clean code).
- Ambiguity log entries get cited months later when a new dev asks "why is it called Workflow not Process?" — the audit trail did its job.
- A cancelled run is bit-identical to "never ran" for canonical files.
- After approval, re-running `/jlu-ubiquitous-language` immediately is a no-op (Step 4 in the orchestrator skips re-extraction; Phase 1 finds no diffs; Phase 5 produces an empty-diff draft).
```

- [ ] **Step 2: Verify size**

Run: `wc -l agents/jlu-glossary-curator.md`

Expected: under 300 lines.

- [ ] **Step 3: Commit**

```bash
git add agents/jlu-glossary-curator.md
git commit -m "feat(glossary): add jlu-glossary-curator agent"
```

---

## Task 9: Orchestrator workflow

**Files:**
- Create: `jelou/workflows/ubiquitous-language.md`

- [ ] **Step 1: Create the workflow file**

```markdown
# Workflow: ubiquitous-language

> Orchestrator workflow for `/jlu-ubiquitous-language [service-id]`
> Curates the workspace's domain glossary using parallel extraction agents and a single curator agent with a review-then-save loop.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST be delegated to the curator agent. The orchestrator itself never asks the user anything.

---

## Step 1 — Resolve Workspace

1. Read `.spec-workspace.json` from the current working directory.
2. If it exists, extract the `workspace` field and resolve it relative to CWD.
3. If `.spec-workspace.json` is missing OR the resolved path does not exist:
   a. Search parent directories (up to 5 levels) for a `.spec-workspace/` directory.
   b. If still not found:
      Stop with: "/jlu-ubiquitous-language requires a `.spec-workspace/`. Run `/jlu-map-codebase` first to set one up."
4. Verify `<WORKSPACE_PATH>/registry/services.yaml` exists.

**Store**: `WORKSPACE_PATH` = absolute path to `.spec-workspace/`.

---

## Step 2 — Resolve Scope

1. If `service-id` was provided as a command argument, set `SCOPED_SERVICE_IDS = [<service-id>]`.
2. Otherwise, read `<WORKSPACE_PATH>/registry/services.yaml` and extract every service id; set `SCOPED_SERVICE_IDS = [all ids]`.
3. For each id in `SCOPED_SERVICE_IDS`, resolve its source path from `services.yaml` (`path` field, relative to workspace).
   - Verify each path exists. If any does not, drop that service from scope and log a one-line warning.

**Store**: `SCOPED_SERVICES` = list of `{id, source_root}` pairs that exist on disk.

---

## Step 3 — Ensure Glossary Directory

1. Create `<WORKSPACE_PATH>/glossary/` if missing.
2. Read `<WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.md` if it exists → `EXISTING_GLOSSARY_CONTENT`.
3. Read `<WORKSPACE_PATH>/glossary/candidates.json` if it exists → `ACCUMULATED_CANDIDATES`.
4. Read `<WORKSPACE_PATH>/glossary/.last-curation.json` if it exists → `LAST_CURATION` (per-service commit map).

**Store**: paths and contents above.

---

## Step 4 — Determine Re-Extraction Set

For each service `{id, source_root}` in `SCOPED_SERVICES`:

1. If `LAST_CURATION` has no entry for this id → mark `MUST_EXTRACT`.
2. Else, run: `cd <source_root> && git rev-parse HEAD` → `CURRENT_SHA`.
   - If `CURRENT_SHA == LAST_CURATION.service_commits[id]` → mark `SKIP_EXTRACTION`.
   - Else → mark `MUST_EXTRACT`.
3. Record `current_commit: CURRENT_SHA` for each scoped service (used by Step 8).

**Store**:
- `SERVICES_TO_EXTRACT` = subset of `SCOPED_SERVICES` to be extracted.
- Augment each entry in `SCOPED_SERVICES` with `current_commit` (so `SCOPED_SERVICES` now has shape `[{id, source_root, current_commit}, ...]`).

If `SERVICES_TO_EXTRACT` is empty AND `ACCUMULATED_CANDIDATES.candidates` is empty AND no spec/interview artifacts are newer than `LAST_CURATION.curated_at`, log "Nothing to curate. Glossary is up-to-date." and exit cleanly (skip remaining steps).

---

## Step 5 — Dispatch Extractor Agents in Parallel

For each service in `SERVICES_TO_EXTRACT`, dispatch one `jlu-glossary-extractor` agent.

**Mandatory rule**: All extractor Agent tool calls go in a SINGLE response (mirror `map-codebase` Step 5 parallel pattern).

Each agent receives this prompt prefix:

```
service-id: <service-id>
SOURCE_ROOT: <source_root>
OUTPUT_FRAGMENT: <WORKSPACE_PATH>/glossary/.tmp/<service-id>.candidates.json
EXISTING_TERMS: <comma-separated list of canonical term names + accumulated candidate names>
MODE: standalone
```

Followed by the full content of `<plugin-root>/agents/jlu-glossary-extractor.md`.

Model: `sonnet`.

Wait for all extractors to complete. If one fails:
- Continue with the rest.
- Capture which service failed.
- The Step 9 report includes the failure.

---

## Step 6 — Collate Candidates

Run the merge helper:

```bash
node <plugin-root>/bin/glossary-merge.mjs --glossary-dir <WORKSPACE_PATH>/glossary
```

This:
- Reads every `*.candidates.json` fragment under `.tmp/`.
- Merges into `<WORKSPACE_PATH>/glossary/candidates.json` (creating it if missing).
- Drops candidates whose names are in `dropped[]` or `promoted[]`.
- Deletes fragment files after a successful merge.

Verify the merger exited 0. If it exited non-zero, stop and report the error.

---

## Step 7 — Read Spec/Conversation Artifacts

Glob:
- `<WORKSPACE_PATH>/specs/**/SPEC.md` → `SPEC_FILES`
- `<WORKSPACE_PATH>/specs/**/INTERVIEW.md` → `INTERVIEW_FILES` (may be empty — current workflows don't write a separate interview transcript; the section appended by Hook B in the SPEC.md is what the curator reads)

Pass file paths only — the curator reads each file as needed.

---

## Step 8 — Dispatch Curator Agent (single, sequential)

Spawn ONE `jlu-glossary-curator` agent. Model: `sonnet`. Prompt prefix:

```
WORKSPACE_PATH: <WORKSPACE_PATH>
EXISTING_GLOSSARY_PATH: <WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.md
CANDIDATES_PATH: <WORKSPACE_PATH>/glossary/candidates.json
DRAFT_PATH: <WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.draft.md
MARKER_PATH: <WORKSPACE_PATH>/glossary/.last-curation.json
SPEC_FILES: <comma-separated paths>
INTERVIEW_FILES: <comma-separated paths>
SCOPED_SERVICES: <JSON array of {id, current_commit} from Step 4>
```

Followed by the full content of `<plugin-root>/agents/jlu-glossary-curator.md`.

Wait for the curator to return. The curator owns the entire interactive review loop; the orchestrator just collects its final summary.

---

## Step 9 — Report Summary

Print to the user:

```
## Ubiquitous Language Curation Complete

- Terms added: <N>
- Terms updated: <M>
- Terms removed: <K>
- Ambiguities resolved: <count>
- Services re-scanned: <comma-separated list>
- Services skipped (unchanged): <comma-separated list>
- Failed extractions: <list, if any>
- Glossary: <WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.md
```

If the curator reported cancellation, print: `Cancelled. No changes written.` and exit 0.

---

## Error Handling

| Error | Action |
|-------|--------|
| `.spec-workspace/` not found anywhere | Stop with the message in Step 1 |
| `services.yaml` missing | Stop with: "Workspace registry missing — run /jlu-map-codebase first." |
| All scoped services' source paths missing on disk | Stop with: "No scoped services exist on disk." |
| `bin/glossary-merge.mjs` not found | Stop with: "Plugin install incomplete — bin/glossary-merge.mjs missing." |
| Single extractor agent failure | Continue; report in Step 9; user can re-run scoped to that service |
| Curator agent failure mid-draft | No canonical/candidates/marker mutation. Draft sidecar may remain — manual cleanup is `rm <WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.draft.md` |
| User cancels review | Draft deleted by curator; canonical untouched; clean exit |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| Canonical glossary | `.spec-workspace/glossary/UBIQUITOUS_LANGUAGE.md` |
| Draft (transient) | `.spec-workspace/glossary/UBIQUITOUS_LANGUAGE.draft.md` |
| Candidates sidecar | `.spec-workspace/glossary/candidates.json` |
| Curation marker | `.spec-workspace/glossary/.last-curation.json` |
| Per-run fragments (transient) | `.spec-workspace/glossary/.tmp/<service-id>.candidates.json` |
```

- [ ] **Step 2: Commit**

```bash
git add jelou/workflows/ubiquitous-language.md
git commit -m "feat(glossary): add /jlu-ubiquitous-language orchestrator workflow"
```

---

## Task 10: SKILL launcher

**Files:**
- Create: `skills/ubiquitous-language/SKILL.md`

This file mirrors `skills/map-codebase/SKILL.md`. It only resolves the plugin root and dispatches a single orchestrator subagent that runs the workflow.

- [ ] **Step 1: Create the skill file**

```markdown
---
name: ubiquitous-language
description: "Use to curate the workspace's domain glossary. Triggers: 'glossary', 'ubiquitous language', 'domain terminology', 'jlu-ubiquitous-language'."
argument-hint: "[service-id]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Agent
---

You are the launcher for the `/jlu-ubiquitous-language` command.

## Phase 1 — Resolve Plugin

Find the Jelou plugin root directory. Try these paths in order:
1. Look for a `jelou/` directory by going up 2 levels from this skill's directory (this is a plugin installation at `<plugin-root>/skills/ubiquitous-language/SKILL.md`).
2. Check `~/.claude/jelou/` (manual installation).

If not found, stop with: "Plugin root not found. Ensure jelou-spec-plugin is installed."

Confirm the workflow file exists at `<plugin-root>/jelou/workflows/ubiquitous-language.md`.

After resolving the plugin root, run the update check protocol at `<plugin-root>/jelou/references/update-check.md`.

## Phase 2 — Dispatch Orchestrator

Spawn a single task subagent with these parameters:
- **model**: `"sonnet"`
- **prompt**: Assemble the prompt in this exact order:
  1. The full content of `<plugin-root>/jelou/references/claude-code-runtime.md` (the runtime contract — maps `question` → `AskUserQuestion`, `task` → `Agent`, and requires the subagent to preload `AskUserQuestion` via `ToolSearch` before Step 1).
  2. A blank line.
  3. The full content of the workflow file at `<plugin-root>/jelou/workflows/ubiquitous-language.md`.
  4. The argument `{argument}`, the plugin root path, and the current working directory.

Do NOT execute the workflow yourself. Your only job is to dispatch and return the agent's result.
```

- [ ] **Step 2: Commit**

```bash
git add skills/ubiquitous-language/SKILL.md
git commit -m "feat(glossary): add /jlu-ubiquitous-language SKILL launcher"
```

---

## Task 11: Hook A — modify `/jlu-map-codebase` workflow

**Files:**
- Modify: `jelou/workflows/map-codebase.md`

Insert a new Step 8 between current `### 7b. Write Analysis Marker` and current `## Step 8 — Report Summary`. Renumber the existing Step 8 → Step 9. Append a Glossary section to the summary template.

- [ ] **Step 1: Insert the new Step 8**

Open `jelou/workflows/map-codebase.md`. Find the section that starts:

```markdown
## Step 8 — Report Summary

Present a final summary to the user:
```

Replace it with:

```markdown
## Step 8 — Glossary Candidate Extraction (background hook)

> Fail-soft: if anything in this step errors, log a one-line warning and continue to Step 9. The 6 codebase docs are the primary deliverable; glossary candidates are a bonus.

### Precondition

If `WORKSPACE_PATH` is not resolved, skip this step entirely.

Otherwise:
- Create `<WORKSPACE_PATH>/glossary/` if missing.
- Create `<WORKSPACE_PATH>/glossary/.tmp/` if missing.

### Dispatch Extractor

Spawn a SINGLE `jlu-glossary-extractor` agent (model: `sonnet`) for the just-mapped service.

Prompt prefix:
```
service-id: <service-id>
SOURCE_ROOT: <SOURCE_ROOT>
OUTPUT_FRAGMENT: <WORKSPACE_PATH>/glossary/.tmp/<service-id>.candidates.json
EXISTING_TERMS: <union of canonical term names from UBIQUITOUS_LANGUAGE.md (if exists) and candidate names from candidates.json (if exists)>
MODE: hook
```

Followed by the full content of `<plugin-root>/agents/jlu-glossary-extractor.md`.

### Merge Fragment

After the extractor completes, run:

```bash
node <plugin-root>/bin/glossary-merge.mjs --glossary-dir <WORKSPACE_PATH>/glossary
```

If the merger fails, log a one-line warning ("Glossary merge skipped — <reason>") and continue.

### On Failure

If the extractor itself fails or never produces a fragment, log: "Glossary candidate extraction skipped — <reason>". Do NOT fail the map-codebase run.

---

## Step 9 — Report Summary

Present a final summary to the user:
```

Then find the existing summary code block (the one starting with `## Map Codebase Complete`) and append a `### Glossary` section. Replace:

```
### Notes
- <any areas flagged for manual review>
- <any agents that required retries>
```

With:

```
### Glossary
- New candidate terms: <count from Step 8 merger output, or "skipped" if Step 8 was skipped>
- Run `/jlu-ubiquitous-language` to curate the workspace glossary.

### Notes
- <any areas flagged for manual review>
- <any agents that required retries>
```

- [ ] **Step 2: Verify the file is well-formed by reading it back**

Run: `grep -n "^## Step" jelou/workflows/map-codebase.md`

Expected: shows Step 1 through Step 9, with Step 8 = Glossary and Step 9 = Report Summary.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/map-codebase.md
git commit -m "feat(map-codebase): hook glossary candidate extraction after codebase docs"
```

---

## Task 12: Hook B — modify `/jlu-new-task` workflow

**Files:**
- Modify: `jelou/workflows/new-task.md`

Insert a new sub-step 14.0 (Load Canonical Glossary) before 14a, and augment 14b/14c with glossary-aware behavior.

- [ ] **Step 1: Insert Step 14.0 before 14a**

Open `jelou/workflows/new-task.md`. Find the line:

```markdown
### 14a — Gap Analysis (silent)
```

Insert immediately above it (with a blank line before and after):

```markdown
### 14.0 — Load Canonical Glossary (read-only)

Before gap analysis, check for a canonical glossary at `<WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.md`.

If the file exists:
- Read it.
- Extract: term names, one-sentence definitions, aliases-to-avoid.
- Hold this as `CANONICAL_TERMS` for the rest of Step 14.

If the file does not exist, skip this sub-step silently. Do NOT prompt the user to create a glossary.

> **No writes**: This sub-step (and all of Step 14) NEVER edits `UBIQUITOUS_LANGUAGE.md`, `candidates.json`, or any glossary artifact. Glossary curation happens via `/jlu-ubiquitous-language`, not here.

```

- [ ] **Step 2: Augment 14b with term-suggestion behavior**

Find the existing `### 14b — Structured Interview` section. At the end of its bullet list (after the `**Respect the user**` bullet), append two new bullets:

```markdown
- **Term-suggestion (when `CANONICAL_TERMS` is loaded)**: If the user mentions a word that appears as an alias-to-avoid in `CANONICAL_TERMS`, reflect back the canonical term and cite the glossary. Example: if canonical has `Workflow` with alias `Process`, and the user says "track when a Process completes", reply with "Got it — tracking Workflow completion. (Using 'Workflow' per the workspace glossary; 'Process' is listed as an alias to avoid.)"
- **Definition-anchoring (when `CANONICAL_TERMS` is loaded)**: When asking clarifying questions about a term that is in `CANONICAL_TERMS`, phrase the question in terms of the canonical definition rather than re-asking what the term means.
```

- [ ] **Step 3: Augment 14c with the "Terms introduced by this spec" section**

Find the `### 14c — Write SPEC.md` section. Find the closing ` ``` ` of the SPEC.md template (the one ending after `### Success Criteria` and the SC list).

Inside that template, immediately AFTER the `### Success Criteria` block (but still inside the markdown code fence showing the SPEC.md template), insert:

```markdown
## Terms introduced by this spec

<!--
List any non-generic domain terms used in this spec that are NOT yet in the canonical glossary at .spec-workspace/glossary/UBIQUITOUS_LANGUAGE.md.
This section is read by /jlu-ubiquitous-language as one of the spec/conversation sources.
Free-text bulleted list. One line per term. No definitions required.
Skip this section entirely if all terms used here are already canonical OR if no glossary exists.
-->

- {{Term1}} — {{optional one-line context}}
- {{Term2}} — {{optional one-line context}}
```

Then, AFTER the closing ` ``` ` of the SPEC.md template block (so it is part of the workflow prose, not the template), insert these two new rules into the existing "Rules for writing:" list (or as a separate paragraph if cleaner):

```markdown
- If `CANONICAL_TERMS` is empty (no glossary exists), OMIT the `## Terms introduced by this spec` section entirely from `SPEC.md`.
- If `CANONICAL_TERMS` is non-empty, populate the `## Terms introduced by this spec` section with every domain term used in `SPEC.md` that is NOT in `CANONICAL_TERMS`. Apply the same domain-specificity filter as `agents/jlu-glossary-extractor.md` — skip generic programming nouns. If no terms qualify, write the section header followed by `<!-- No new domain terms introduced. -->`.
```

- [ ] **Step 4: Verify the file is well-formed**

Run: `grep -n "^### 14" jelou/workflows/new-task.md`

Expected: shows `### 14.0 — Load Canonical Glossary (read-only)`, `### 14a — Gap Analysis (silent)`, `### 14b — Structured Interview`, `### 14c — Write SPEC.md`, `### 14d — Present for Approval`.

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "feat(new-task): consult canonical glossary in Step 14 (read-only)"
```

---

## Task 13: Mirror inlined Phase 0 changes into the canonical reference doc

**Files:**
- Modify: `agents/jlu-spec-interviewer.md`

This file is the canonical *reference* doc — it is no longer dispatched as a sub-agent. Updating it keeps the documentation accurate; it has no runtime effect.

- [ ] **Step 1: Read the existing file to find the right insertion point**

Run: `head -45 agents/jlu-spec-interviewer.md`

You will see Step 1 starts at line 26 (`## Step 1 — Gap Analysis`).

- [ ] **Step 2: Insert a Phase 0 section before Step 1**

Find the line:

```markdown
## Step 1 — Gap Analysis (do this silently before your first question)
```

Insert immediately above it (with blank lines before and after):

```markdown
## Step 0 — Load Canonical Glossary (read-only)

Before gap analysis, check for a canonical glossary at `<WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.md`.

If the file exists:
- Read it.
- Extract: term names, one-sentence definitions, aliases-to-avoid.
- Hold this as `CANONICAL_TERMS` for the rest of the interview.

If the file does not exist, skip this step silently. Do NOT prompt the user to create a glossary.

**No writes**: This step (and all subsequent steps in this agent) NEVER edits `UBIQUITOUS_LANGUAGE.md`, `candidates.json`, or any glossary artifact. Glossary curation happens via `/jlu-ubiquitous-language`.

When `CANONICAL_TERMS` is loaded, the interview behavior changes in two ways:

1. **Term-suggestion**: If the user mentions an alias-to-avoid, reflect back the canonical term and cite the glossary.
2. **Definition-anchoring**: Phrase clarifying questions in terms of the canonical definition for known terms; do not re-ask what they mean.

When writing `SPEC.md`, include a `## Terms introduced by this spec` section with any non-generic domain terms NOT in `CANONICAL_TERMS`. This section is read by `/jlu-ubiquitous-language` later. Omit the section entirely if `CANONICAL_TERMS` is empty.

```

- [ ] **Step 3: Commit**

```bash
git add agents/jlu-spec-interviewer.md
git commit -m "docs(spec-interviewer): mirror inlined glossary-aware Phase 0 changes"
```

---

## Task 14: Add the new command to README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read the current command-list section**

Run: `grep -n "jlu-" README.md | head -20`

Find the section that lists `/jlu-new-task`, `/jlu-execute-task`, `/jlu-create-pr`, etc.

- [ ] **Step 2: Add the new command to that list**

Locate the line:

```markdown
Use commands like `/jlu-new-task`, `/jlu-execute-task`, `/jlu-create-pr`.
```

Replace with:

```markdown
Use commands like `/jlu-new-task`, `/jlu-execute-task`, `/jlu-create-pr`, `/jlu-ubiquitous-language`.
```

If there is also a "What It Does" bullet list near the top, append one bullet:

```markdown
- **Ubiquitous language**: `/jlu-ubiquitous-language` discovers and curates the workspace's domain glossary across services, anchoring each term to the services where it's implemented and referenced.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): mention /jlu-ubiquitous-language command"
```

---

## Task 15: End-to-end smoke test (manual)

**Files:**
- None — this is a manual verification, not a committed artifact.

This task validates the assembled pieces work together. It does not commit anything; it produces a one-line ✅/❌ status that the engineer reports back.

- [ ] **Step 1: Set up a throwaway `.spec-workspace/`**

```bash
mkdir -p /tmp/glossary-smoke/.spec-workspace/registry
mkdir -p /tmp/glossary-smoke/.spec-workspace/services
mkdir -p /tmp/glossary-smoke/.spec-workspace/specs
cd /tmp/glossary-smoke

cat > .spec-workspace.json <<'EOF'
{ "workspace": ".spec-workspace" }
EOF

cat > .spec-workspace/registry/services.yaml <<'EOF'
services:
  - id: svc-a
    path: ./svc-a
EOF

mkdir -p svc-a/src
cat > svc-a/src/workflow.entity.ts <<'EOF'
export class Workflow {
  id: string;
}
EOF

cd svc-a && git init -q && git add . && git commit -q -m "init" && cd ..
```

- [ ] **Step 2: Run the merge helper directly (smoke test for Task 1-5)**

```bash
mkdir -p .spec-workspace/glossary/.tmp
cat > .spec-workspace/glossary/.tmp/svc-a.candidates.json <<'EOF'
{
  "service_id": "svc-a",
  "scanned_commit": "abc",
  "candidates": [
    {
      "term": "Workflow",
      "evidence": [{"path": "src/workflow.entity.ts", "line": 1, "kind": "entity-class"}],
      "location_role": "definition",
      "heuristic_confidence": "high"
    }
  ],
  "location_updates": []
}
EOF

node <plugin-root>/bin/glossary-merge.mjs --glossary-dir .spec-workspace/glossary
cat .spec-workspace/glossary/candidates.json
```

Expected: a `candidates.json` containing one entry for `Workflow`, scoped to `svc-a`. The fragment under `.tmp/` should be deleted.

- [ ] **Step 3: Document the result and clean up**

Report ✅ if Step 2 succeeded, ❌ otherwise with the error.

```bash
rm -rf /tmp/glossary-smoke
```

- [ ] **Step 4: (No commit — manual verification only)**

---

## Self-Review (run by author after writing the plan)

### Spec Coverage

| Spec section | Covered by tasks |
|--------------|------------------|
| File layout (skill, agents, workflow, template, modified workflows, modified reference doc) | Tasks 6, 7, 8, 9, 10, 11, 12, 13 |
| Workspace artifacts (UBIQUITOUS_LANGUAGE.md, draft, candidates.json, .last-curation.json) | Tasks 6, 8, 9, 15 (smoke) |
| Standalone workflow Steps 1-9 | Task 9 |
| Extractor agent contract (heuristics, reject list, confidence, output) | Task 7 |
| Curator agent contract (synthesis, ambiguity classes, interview, draft, review loop, free-text feedback) | Task 8 |
| Hook A (map-codebase) | Task 11 |
| Hook B (new-task Step 14) | Task 12 |
| Documentation update for canonical agent reference | Task 13 |
| Edge cases (cancel safety, fail-soft hook, missing workspace) | Encoded in Tasks 8, 9, 11 |
| Testing strategy: extractor unit + reject-list, orchestrator workflow, curator review loop, hook A/B integration | Tasks 1-5 (merge helper unit), 15 (smoke). Agent-prompt pressure-test fixtures and hook integration tests are explicitly out of scope per skill-development.md (pressure harness must be extended to support these agent types first). |

### Placeholder Scan

- No "TBD", "TODO", "implement later".
- All file paths are exact.
- All code blocks are complete (no "...similar to above").
- All bash commands have explicit expected output.

### Type/Name Consistency

- `glossary-merge.mjs` flag is `--glossary-dir` everywhere (Tasks 1, 2, 9, 11).
- Fragment path is `<glossary>/.tmp/<service-id>.candidates.json` everywhere.
- Marker file is `.last-curation.json` everywhere.
- `CANONICAL_TERMS` is the variable name in Step 14 (Task 12) and the canonical agent doc (Task 13).
- Agent names: `jlu-glossary-extractor`, `jlu-glossary-curator`. Matches frontmatter `name:` fields.
- The new SKILL is named `ubiquitous-language` (matches directory name, frontmatter, and skill description).

### Out of Scope (carried from spec)

- Concurrency lock for parallel `/jlu-ubiquitous-language` runs.
- Per-service overlay glossaries.
- Spec-reviewer terminology check (a future hook in `jlu-spec-reviewer`).
- Glossary export formats (markdown only).
- Glossary lookup command.
- Auto-PR generation when terms change.
- **Agent pressure-test fixtures** for the new agents — the harness only supports `writer-agent` and `fix-loop` currently; extending it is a separate effort per `jelou/references/skill-development.md`.
- **Hook A/B integration tests** — same harness limitation. Tracked as the manual smoke in Task 15 for v1.
