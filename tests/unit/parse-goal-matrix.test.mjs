import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGoalMatrix } from '../../bin/parse-goal-matrix.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'parse-goal-matrix.mjs');

describe('parseGoalMatrix — text input', () => {
  test('parses bullet lines with level tags, service tags, and criteria', () => {
    const { objectives } = parseGoalMatrix(
      '- crear un producto y verlo en la lista [fullstack] @brain-ui => el producto aparece en la lista\n' +
        '- el POST persiste en Mongo [backend] @products-api',
    );
    assert.equal(objectives.length, 2);
    assert.deepEqual(
      objectives.map((o) => o.id),
      ['G1', 'G2'],
    );
    assert.equal(objectives[0].level, 'fullstack');
    assert.deepEqual(objectives[0].services, ['brain-ui']);
    assert.equal(objectives[0].success_criteria, 'el producto aparece en la lista');
    assert.equal(objectives[0].title, 'crear un producto y verlo en la lista');
    assert.equal(objectives[1].level, 'backend');
    assert.deepEqual(objectives[1].services, ['products-api']);
    assert.deepEqual(objectives[1].ambiguities, []);
  });

  test('splits a single line on semicolons', () => {
    const { objectives } = parseGoalMatrix('login funciona [frontend] @app; checkout cobra [backend] @api');
    assert.equal(objectives.length, 2);
    assert.equal(objectives[0].level, 'frontend');
    assert.equal(objectives[1].level, 'backend');
  });

  test('normalizes level aliases', () => {
    const levels = ['[front]', '[ui]', '[back]', '[api]', '[full]'].map(
      (tag) => parseGoalMatrix(`objetivo ${tag} @svc`).objectives[0].level,
    );
    assert.deepEqual(levels, ['frontend', 'frontend', 'backend', 'backend', 'fullstack']);
  });

  test('defaults success_criteria to the title when no => is given', () => {
    const { objectives } = parseGoalMatrix('el dashboard carga [frontend] @app');
    assert.equal(objectives[0].success_criteria, 'el dashboard carga');
  });

  test('flags missing level and missing services as ambiguities', () => {
    const { objectives } = parseGoalMatrix('algo funciona bien');
    assert.equal(objectives[0].level, 'unknown');
    assert.deepEqual(objectives[0].ambiguities, ['level', 'services']);
  });
});

describe('parseGoalMatrix — JSON input', () => {
  test('accepts an array of objective objects', () => {
    const { objectives } = parseGoalMatrix(
      JSON.stringify([
        { title: 'checkout completes', level: 'fullstack', services: ['shop-ui', 'orders-api'], success_criteria: 'order row persisted' },
      ]),
    );
    assert.equal(objectives[0].id, 'G1');
    assert.equal(objectives[0].level, 'fullstack');
    assert.deepEqual(objectives[0].services, ['shop-ui', 'orders-api']);
    assert.equal(objectives[0].success_criteria, 'order row persisted');
  });

  test('accepts { objectives: [...] } and string entries', () => {
    const { objectives } = parseGoalMatrix(
      JSON.stringify({ objectives: ['login funciona [frontend] @app', { title: 'api responde', level: 'backend', services: ['api'] }] }),
    );
    assert.equal(objectives.length, 2);
    assert.equal(objectives[0].level, 'frontend');
    assert.equal(objectives[1].level, 'backend');
  });

  test('marks an invalid level as unknown with a level ambiguity', () => {
    const { objectives } = parseGoalMatrix(JSON.stringify([{ title: 'x', level: 'mobile', services: ['app'] }]));
    assert.equal(objectives[0].level, 'unknown');
    assert.ok(objectives[0].ambiguities.includes('level'));
  });

  test('rejects an objective without a title', () => {
    assert.throws(() => parseGoalMatrix('[{"level":"backend"}]'), /non-empty title/);
  });

  test('rejects JSON that does not parse', () => {
    assert.throws(() => parseGoalMatrix('[{broken'), /does not parse/);
  });
});

describe('parseGoalMatrix — flags', () => {
  test('extracts --task, --max-iterations, and boolean flags from the input', () => {
    const { objectives, flags } = parseGoalMatrix('login funciona [frontend] @app --task=add-oauth --max-iterations=5 --force');
    assert.equal(objectives.length, 1);
    assert.equal(flags.task, 'add-oauth');
    assert.equal(flags['max-iterations'], 5);
    assert.equal(flags.force, true);
  });

  test('a flags-only input yields zero objectives (resume mode)', () => {
    const { objectives, flags } = parseGoalMatrix('--task=add-oauth');
    assert.equal(objectives.length, 0);
    assert.equal(flags.task, 'add-oauth');
  });

  test('rejects a non-positive --max-iterations', () => {
    assert.throws(() => parseGoalMatrix('x [backend] @api --max-iterations=0'), /positive integer/);
  });
});

describe('parseGoalMatrix — invalid input', () => {
  test('throws on empty input', () => {
    assert.throws(() => parseGoalMatrix(''), /empty input/);
    assert.throws(() => parseGoalMatrix('   '), /empty input/);
  });
});

describe('parse-goal-matrix CLI', () => {
  test('prints the parsed matrix as JSON on stdout', () => {
    const out = execFileSync('node', [BIN, 'login funciona [frontend] @app'], { encoding: 'utf8' });
    const parsed = JSON.parse(out);
    assert.equal(parsed.objectives[0].id, 'G1');
    assert.equal(parsed.objectives[0].level, 'frontend');
  });

  test('exits 1 with a stderr message on empty input', () => {
    assert.throws(
      () => execFileSync('node', [BIN, ''], { encoding: 'utf8', stdio: 'pipe' }),
      (err) => err.status === 1 && /empty input/.test(err.stderr),
    );
  });
});
