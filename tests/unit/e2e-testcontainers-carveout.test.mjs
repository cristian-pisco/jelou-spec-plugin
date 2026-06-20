// tests/unit/e2e-testcontainers-carveout.test.mjs
//
// Guards the single path-scoped carve-out of the global Testcontainers ban:
// allowed ONLY in test/e2e/** or *.e2e-spec.ts, executed ONLY by production-like.
//
// Run: `node --test tests/unit/e2e-testcontainers-carveout.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const E2E_PATH = /test\/e2e\/\*\*|\*\.e2e-spec\.ts/;

describe('Testcontainers carve-out — E2E path is the only exception', () => {
  test('qa-agent exempts the E2E path and still bans it elsewhere', () => {
    const qa = read('agents/jlu-qa-agent.md');
    assert.match(qa, E2E_PATH);
    assert.match(qa, /production-like/);
    assert.match(qa, /outside the E2E path/i);
  });

  test('test-writer allows Testcontainers only in the E2E path', () => {
    const tw = read('agents/jlu-test-writer.md');
    assert.match(tw, E2E_PATH);
    assert.match(tw, /Testcontainers .*only .*E2E path|E2E path .*Testcontainers/i);
    assert.match(tw, /never in Tier 1\/2|not in Tier 1\/2/i);
  });

  test('subagent-base scopes the ban to non-E2E paths', () => {
    const base = read('jelou/references/subagent-base.md');
    assert.match(base, E2E_PATH);
    assert.match(base, /production-like/);
  });

  test('tdd-cycle notes the E2E exception', () => {
    const tdd = read('jelou/references/tdd-cycle.md');
    assert.match(tdd, E2E_PATH);
    assert.match(tdd, /production-like/);
  });
});
