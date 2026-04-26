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
    assert.match(body, /\*\*Problem\*\*: p1/);
    assert.match(body, /\*\*Solution\*\*: s1/);
    assert.match(body, /\*\*Leverage\*\*: l/);
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
