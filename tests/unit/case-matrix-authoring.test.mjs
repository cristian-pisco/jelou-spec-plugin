// tests/unit/case-matrix-authoring.test.mjs
//
// Guards the per-requirement CASE MATRIX that the TDD authors must derive from
// the DTO/validator surface (success + one rejection per validation decorator +
// a realistic populated-reference payload), and asserts the old permissive
// directives that produced happy-path-only suites are gone. These directives
// are the origin fix for the production 400 (a GUID string into an @IsNumber()
// field) that a green-but-thin suite never exercised.
//
// Run: `node --test tests/unit/case-matrix-authoring.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('jlu-tdd-cycle.md — case-matrix RED floor', () => {
  const a = read('agents/jlu-tdd-cycle.md');
  test('mandates a per-requirement case matrix', () => {
    assert.match(a, /case matrix/i);
    assert.match(a, /per validation decorator/);
  });
  test('drops the "one behavior, not all of them" minimalism', () => {
    assert.doesNotMatch(a, /one happy path, or one error path, or one edge case — not all of them/);
  });
  test('no longer gates extra cases on the spec calling them out', () => {
    assert.doesNotMatch(a, /edge cases the spec calls out/);
  });
});

describe('jlu-test-writer.md — rejection + realistic mandate', () => {
  const a = read('agents/jlu-test-writer.md');
  test('mandates a rejecting payload per validation decorator', () => {
    assert.match(a, /rejecting payload per validation decorator/);
  });
  test('mandates a realistic payload populating cross-field references', () => {
    assert.match(a, /populates every cross-field reference/);
  });
  test('drops the anti-coverage / no-speculative-edge-case guardrails', () => {
    assert.doesNotMatch(a, /Don't write tests for the sake of coverage/);
    assert.doesNotMatch(a, /no speculative edge cases/);
  });
});

describe('jlu-ui-e2e-writer.md — non-default field + reference coverage', () => {
  const a = read('agents/jlu-ui-e2e-writer.md');
  test('requires exercising a non-default field type', () => {
    assert.match(a, /non-default field type/);
  });
  test('introduces rule 4b and applies it in both modes (not just derive-from-spec)', () => {
    assert.match(a, /rule 4b/i);
    assert.match(a, /both normal and derive-from-spec/i);
  });
});

describe('tdd-cycle.md — case-matrix floor promoted from a "should"', () => {
  const ref = read('jelou/references/tdd-cycle.md');
  test('names the case-matrix floor', () => {
    assert.match(ref, /case-matrix floor/);
  });
  test('lists the realistic / cross-field path class', () => {
    assert.match(ref, /Realistic \/ cross-field paths/);
  });
});
