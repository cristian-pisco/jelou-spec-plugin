import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(join(root, 'jelou/workflows/new-task.md'), 'utf8');
const conventions = readFileSync(join(root, 'jelou/references/git-conventions.md'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

describe('new-task English slug contract', () => {
  test('translates semantic words before slugification', () => {
    assert.match(workflow, /concise English action phrase/);
    assert.match(workflow, /Translate semantic words to English before slugification/);
    assert.match(workflow, /slug must contain English semantic words only/);
  });

  test('preserves technical names without translating the spec', () => {
    assert.match(workflow, /Keep technical identifiers, product names, acronyms, and version numbers unchanged/);
    assert.match(workflow, /Do not translate or rewrite `TASK_DESCRIPTION` or the human-facing SPEC content/);
  });

  test('documents the Spanish regression example', () => {
    assert.match(workflow, /Actualizar Fastify Middie para NestJS 11` becomes `update-fastify-middie-nestjs-11`/);
    assert.match(workflow, /never `actualizar-fastify-middie-nestjs-11`/);
  });

  test('pins the English convention in Git and user documentation', () => {
    assert.match(conventions, /Slugs use English semantic words/);
    assert.match(readme, /always derives `<slug>` with English semantic words/);
  });
});
