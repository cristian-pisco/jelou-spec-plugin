import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('rejection batching — cycle granularity', () => {
  const ref = read('jelou/references/tdd-cycle.md');
  const agent = read('agents/jlu-tdd-cycle.md');

  test('derivation procedure batches same-surface rejection cases into one slice', () => {
    assert.match(ref, /ONE batched slice/);
    assert.doesNotMatch(ref, /one \*\*rejection\*\* slice per/);
  });

  test('coverage floor is unchanged — one rejection case per decorator', () => {
    assert.match(ref, /one rejection case per\s+decorator\/type constraint/);
  });

  test('agent batches rejections and drops the absolute one-slice rule', () => {
    assert.match(agent, /Rejection cases are batched/);
    assert.doesNotMatch(agent, /One slice at a time\. No exceptions\./);
    assert.doesNotMatch(agent, /Never write two tests before the first is GREEN/);
  });

  test('agent never batches across surfaces', () => {
    assert.match(agent, /Never interleave two surfaces in one batch/);
  });
});

describe('boundary batching — boundaries ride the surface slice', () => {
  const ref = read('jelou/references/tdd-cycle.md');
  const agent = read('agents/jlu-tdd-cycle.md');
  const principles = read('jelou/references/tdd-principles.md');

  test('derivation procedure folds boundary cases into the surface batch', () => {
    assert.match(ref, /Boundary cases join the same\s+surface's batch/);
    assert.doesNotMatch(ref, /one behavior slice \(success \/ realistic \/ boundary\)/);
  });

  test('agent batches boundary cases with the surface', () => {
    assert.match(agent, /Boundary cases for that surface join the same batch/);
    assert.match(agent, /boundary-accept tests in the batch may already pass on RED/i);
  });

  test('principles exception covers boundaries', () => {
    assert.match(principles, /together with that surface's boundary cases/);
  });
});
