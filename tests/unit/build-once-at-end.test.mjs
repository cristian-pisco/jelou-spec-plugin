import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = () => readFileSync(join(ROOT, 'jelou', 'workflows', 'execute-task.md'), 'utf8');
const agent = () => readFileSync(join(ROOT, 'agents', 'jlu-build-validator.md'), 'utf8');

function between(text, startRe, endRe) {
  const start = text.search(startRe);
  if (start === -1) return '';
  const tail = text.slice(start);
  const end = tail.search(endRe);
  return end === -1 ? tail : tail.slice(0, end);
}

describe('build-once-at-end', () => {
  test('the per-phase build step (7k) is gone', () => {
    assert.doesNotMatch(workflow(), /###\s*7k\.\s*Build Validation/);
  });

  test('build validation lives in a per-service final step (8a.5)', () => {
    const s = between(
      workflow(),
      /###\s*8a\.5\s*—\s*Build Validation \(once per service\)/,
      /\n###\s+8b\./,
    );
    assert.ok(s, 'expected an "### 8a.5 — Build Validation (once per service)" section');
    assert.match(s, /jlu-build-validator/);
  });

  test('no build-validator dispatch remains in the Step 7 per-phase loop', () => {
    const loop = between(workflow(), /\n###\s+7a\./, /\n###\s+8a\./);
    assert.ok(loop, 'expected to locate the Step 7 loop body');
    assert.doesNotMatch(loop, /jlu-build-validator/);
  });

  test('build-validator agent no longer claims a per-phase cadence', () => {
    assert.doesNotMatch(agent(), /after each (TDD )?phase/i);
  });
});
