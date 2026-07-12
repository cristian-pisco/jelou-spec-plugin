import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRegress } from '../../bin/trace-regress.mjs';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(PROJECT_ROOT, 'bin', 'trace-regress.mjs');

let dir;
let goldenDir;
let baselineFile;

function seedGolden(root) {
  const impl = join(root, 'implementer');
  const tw = join(root, 'test-writer');
  mkdirSync(impl, { recursive: true });
  mkdirSync(tw, { recursive: true });
  writeFileSync(join(impl, 'a.json'), JSON.stringify({ id: 'x-001', agent_role: 'implementer', reference: 'r', output: 'o' }));
  writeFileSync(join(tw, 'b.json'), JSON.stringify({ id: 'x-002', agent_role: 'test-writer', reference: 'r', output: 'o' }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'trace-regress-cli-'));
  goldenDir = join(dir, 'golden');
  baselineFile = join(dir, 'baseline.json');
  seedGolden(goldenDir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runRegress (injected scoreFn)', () => {
  test('scores below baseline beyond margin → regressed:true', async () => {
    writeFileSync(baselineFile, JSON.stringify({ 'x-001': 0.9, 'x-002': 0.9 }));
    const result = await runRegress({
      goldenDir,
      baselineFile,
      scoreFn: async () => 0.5,
    });
    assert.equal(result.regressed, true);
    assert.equal(result.dropped, 2);
    assert.equal(result.per_example.length, 2);
  });

  test('scores at baseline → regressed:false', async () => {
    const baseline = { 'x-001': 0.9, 'x-002': 0.8 };
    writeFileSync(baselineFile, JSON.stringify(baseline));
    const result = await runRegress({
      goldenDir,
      baselineFile,
      scoreFn: async (example) => baseline[example.id],
    });
    assert.equal(result.regressed, false);
    assert.equal(result.delta, 0);
  });

  test('missing apiKey and no scoreFn → skipped', async () => {
    const result = await runRegress({ goldenDir, baselineFile, apiKey: '' });
    assert.deepEqual(result, { skipped: true, reason: 'no OPENROUTER_API_KEY' });
  });

  test('updateBaseline:true writes current scores to the baseline file', async () => {
    assert.equal(existsSync(baselineFile), false);
    const result = await runRegress({
      goldenDir,
      baselineFile,
      updateBaseline: true,
      scoreFn: async (example) => (example.id === 'x-001' ? 0.71 : 0.62),
    });
    assert.deepEqual(result, { updated: true });
    const written = JSON.parse(readFileSync(baselineFile, 'utf8'));
    assert.deepEqual(written, { 'x-001': 0.71, 'x-002': 0.62 });
  });
});

describe('bin/trace-regress.mjs (spawned CLI)', () => {
  function run(args, env) {
    const clean = { ...process.env };
    delete clean.OPENROUTER_API_KEY;
    delete clean.TRACE_REGRESS_SCORES;
    return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', env: { ...clean, ...env } });
  }

  test('no key and no scores → skips cleanly with exit 0', () => {
    writeFileSync(baselineFile, JSON.stringify({ 'x-001': 0.9, 'x-002': 0.9 }));
    const r = run(['--golden-dir', goldenDir, '--baseline', baselineFile]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /no OPENROUTER_API_KEY/i);
  });

  test('deterministic scores below baseline → regression exits 4', () => {
    writeFileSync(baselineFile, JSON.stringify({ 'x-001': 0.9, 'x-002': 0.9 }));
    const scoresFile = join(dir, 'scores.json');
    writeFileSync(scoresFile, JSON.stringify({ 'x-001': 0.4, 'x-002': 0.4 }));
    const r = run(
      ['--golden-dir', goldenDir, '--baseline', baselineFile],
      { TRACE_REGRESS_SCORES: scoresFile },
    );
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stdout, /REGRESSION/i);
  });
});
