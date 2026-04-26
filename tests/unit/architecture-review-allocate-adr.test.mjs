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
