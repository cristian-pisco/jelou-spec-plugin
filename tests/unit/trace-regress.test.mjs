import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGolden, detectRegression } from '../../bin/lib/trace/regress.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SEEDED_GOLDEN = join(ROOT, 'tests', 'golden');

describe('loadGolden', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'golden-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('reads the seeded synthetic examples across role subdirs', () => {
    const examples = loadGolden(SEEDED_GOLDEN);
    const ids = examples.map((e) => e.id).sort();
    assert.deepEqual(ids, ['implementer-001', 'implementer-002', 'test-writer-001', 'test-writer-002']);
    for (const e of examples) {
      assert.equal(typeof e.agent_role, 'string');
      assert.equal(typeof e.reference, 'string');
      assert.equal(typeof e.output, 'string');
    }
  });

  test('skips malformed json and non-example json, keeps valid examples', () => {
    const sub = join(dir, 'implementer');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'good.json'), JSON.stringify({ id: 'r-1', agent_role: 'implementer', reference: 'x', output: 'y' }));
    writeFileSync(join(sub, 'broken.json'), '{ not valid json');
    writeFileSync(join(dir, 'baseline.json'), JSON.stringify({ 'r-1': 0.9 }));
    writeFileSync(join(dir, 'notes.md'), 'ignore me');
    const examples = loadGolden(dir);
    assert.equal(examples.length, 1);
    assert.equal(examples[0].id, 'r-1');
  });

  test('missing directory returns an empty array', () => {
    assert.deepEqual(loadGolden(join(dir, 'does-not-exist')), []);
    assert.deepEqual(loadGolden(undefined), []);
  });
});

describe('detectRegression', () => {
  test('equal scores are not a regression', () => {
    const r = detectRegression({ a: 0.8, b: 0.7 }, { a: 0.8, b: 0.7 });
    assert.equal(r.regressed, false);
    assert.equal(r.delta, 0);
    assert.equal(r.improved, 0);
    assert.equal(r.dropped, 0);
    assert.equal(r.per_example.length, 2);
  });

  test('mean drop beyond margin is a regression', () => {
    const r = detectRegression({ a: 0.7, b: 0.6 }, { a: 0.8, b: 0.7 }, { margin: 0.05, perExampleMargin: 0.5 });
    assert.equal(r.regressed, true);
    assert.ok(r.delta < -0.05);
    assert.equal(r.dropped, 2);
    assert.equal(r.improved, 0);
  });

  test('a single example dropping beyond perExampleMargin is a regression even if mean holds', () => {
    const r = detectRegression({ a: 0.5, b: 0.99 }, { a: 0.8, b: 0.7 }, { margin: 0.5, perExampleMargin: 0.15 });
    assert.equal(r.regressed, true);
    assert.equal(r.dropped, 1);
    assert.equal(r.improved, 1);
  });

  test('an overall improvement is not a regression', () => {
    const r = detectRegression({ a: 0.9, b: 0.85 }, { a: 0.8, b: 0.7 });
    assert.equal(r.regressed, false);
    assert.ok(r.delta > 0);
    assert.equal(r.improved, 2);
    assert.equal(r.dropped, 0);
  });

  test('empty overlap is not a regression', () => {
    const r = detectRegression({ a: 0.9 }, { z: 0.1 });
    assert.equal(r.regressed, false);
    assert.equal(r.per_example.length, 0);
    assert.equal(r.mean_current, 0);
    assert.equal(r.mean_baseline, 0);
  });

  test('only ids present in both maps are paired', () => {
    const r = detectRegression({ a: 0.8, b: 0.6, extra: 0.1 }, { a: 0.8, b: 0.8, missing: 0.9 });
    assert.deepEqual(r.per_example.map((e) => e.id).sort(), ['a', 'b']);
    assert.equal(r.dropped, 1);
    assert.equal(r.improved, 0);
  });
});
