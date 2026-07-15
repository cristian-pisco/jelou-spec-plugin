import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const CLASSIFY = join(ROOT, 'bin', 'classify-phase.sh');

function runMode(frCount) {
  const dir = mkdtempSync(join(tmpdir(), 'single-mech-'));
  const bullets = Array.from({ length: frCount }, (_, i) => `- FR-${i + 1}: behavior ${i + 1}`).join('\n');
  writeFileSync(join(dir, 'phase.md'), `# Phase 01\n\n## Requirements (immutable)\n${bullets}\n`);
  const r = spawnSync('bash', [CLASSIFY, 'mode'], {
    env: { ...process.env, CLASSIFY_PHASE_FILE: join(dir, 'phase.md'), CLASSIFY_SERVICES_IN_PHASE: '1' },
    encoding: 'utf8',
  });
  rmSync(dir, { recursive: true, force: true });
  const out = {};
  for (const line of r.stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

describe('single TDD mechanism', () => {
  test('classify-phase mode never emits vertical/horizontal (2 FR)', () => {
    assert.equal(runMode(2).mode, 'tdd');
  });
  test('classify-phase mode never emits vertical/horizontal (8 FR)', () => {
    assert.equal(runMode(8).mode, 'tdd');
  });

  test('execute-task.md has no dispute step and no separate RED/GREEN authoring steps', () => {
    const wf = read('jelou/workflows/execute-task.md');
    assert.doesNotMatch(wf, /###\s*7f\./);
    assert.doesNotMatch(wf, /###\s*7de\./);
    assert.doesNotMatch(wf, /###\s*7e\.\s*TDD Green/);
    assert.doesNotMatch(wf, /Test Dispute/i);
  });

  test('jlu-tdd-cycle no longer restricts itself to small/≤3 phases', () => {
    const a = read('agents/jlu-tdd-cycle.md');
    assert.doesNotMatch(a, /≤\s*3/);
    assert.doesNotMatch(a, /small single-service/i);
    assert.doesNotMatch(a, /N\s*≤\s*3/);
  });

  test('surviving agents drop the dispute (Decision #5) sections', () => {
    assert.doesNotMatch(read('agents/jlu-implementer.md'), /Decision #5/);
    assert.doesNotMatch(read('agents/jlu-test-writer.md'), /Handling Test Disputes/i);
  });

  test('reference docs drop the dispute (Decision #5) machinery', () => {
    for (const rel of ['jelou/references/subagent-contract.md', 'jelou/references/systematic-debugging.md']) {
      const doc = read(rel);
      assert.doesNotMatch(doc, /Decision #5/);
      assert.doesNotMatch(doc, /test dispute/i);
    }
  });
});
