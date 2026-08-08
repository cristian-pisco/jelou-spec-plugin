import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSections } from '../../bin/extract-doc-sections.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', '..', 'bin', 'extract-doc-sections.mjs');

const DOC = [
  '# STRUCTURE',
  '',
  'Intro prose that must never be printed.',
  '',
  '## Directory Tree',
  '',
  '- src/',
  '- test/',
  '',
  '## Module Organization',
  '',
  'Modules live under `src/<domain>/`.',
  '',
  '### Nested detail',
  '',
  'Kept with its parent section.',
  '',
  '## File Naming Conventions',
  '',
  '`*.service.ts`, `*.controller.ts`.',
  '',
  '## Trailing Section',
  '',
  'last',
  '',
].join('\n');

function writeDoc(content = DOC) {
  const dir = mkdtempSync(join(tmpdir(), 'jlu-extract-doc-'));
  const path = join(dir, 'STRUCTURE.md');
  writeFileSync(path, content);
  return path;
}

function run(args) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('extract-doc-sections — extractSections()', () => {
  test('returns the heading plus its body, excluding the next section', () => {
    const { found, missing } = extractSections(DOC, ['Module Organization']);
    assert.deepEqual(missing, []);
    assert.equal(found.length, 1);
    assert.match(found[0], /^## Module Organization\n/);
    assert.match(found[0], /Modules live under/);
    assert.match(found[0], /### Nested detail/);
    assert.doesNotMatch(found[0], /File Naming Conventions/);
  });

  test('excludes level-1 preamble and unrequested sections', () => {
    const { found } = extractSections(DOC, ['File Naming Conventions']);
    assert.doesNotMatch(found[0], /Intro prose/);
    assert.doesNotMatch(found[0], /Directory Tree/);
    assert.doesNotMatch(found[0], /Trailing Section/);
  });

  test('preserves the requested order, not the document order', () => {
    const { found } = extractSections(DOC, ['File Naming Conventions', 'Module Organization']);
    assert.match(found[0], /^## File Naming Conventions/);
    assert.match(found[1], /^## Module Organization/);
  });

  test('matches section names case-insensitively', () => {
    const { missing } = extractSections(DOC, ['module organization']);
    assert.deepEqual(missing, []);
  });

  test('reports every absent section', () => {
    const { found, missing } = extractSections(DOC, ['Module Organization', 'Nope', 'Also Nope']);
    assert.equal(found.length, 1);
    assert.deepEqual(missing, ['Nope', 'Also Nope']);
  });

  test('a level-1 heading terminates the preceding level-2 section', () => {
    const doc = ['## A', 'a-body', '# Part Two', 'orphan', '## B', 'b-body'].join('\n');
    const { found } = extractSections(doc, ['A']);
    assert.equal(found[0], '## A\na-body');
  });
});

describe('extract-doc-sections — CLI', () => {
  test('prints only the requested sections and exits 0', () => {
    const path = writeDoc();
    const r = run([`--file=${path}`, '--section=Module Organization', '--section=File Naming Conventions']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## Module Organization/);
    assert.match(r.stdout, /## File Naming Conventions/);
    assert.doesNotMatch(r.stdout, /Directory Tree/);
    assert.doesNotMatch(r.stdout, /Trailing Section/);
  });

  test('exits 3 with the missing section names when a section is absent', () => {
    const path = writeDoc();
    const r = run([`--file=${path}`, '--section=Module Organization', '--section=Nonexistent Section']);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /Nonexistent Section/);
    assert.doesNotMatch(r.stderr, /Module Organization/);
    assert.equal(r.stdout, '');
  });

  test('exits 2 when the file does not exist', () => {
    const r = run(['--file=/nonexistent/STRUCTURE.md', '--section=Module Organization']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /file not found/);
  });

  test('exits 1 when --file is missing', () => {
    const r = run(['--section=Module Organization']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--file is required/);
  });

  test('exits 1 when no --section is given', () => {
    const path = writeDoc();
    const r = run([`--file=${path}`]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /at least one --section/);
  });

  test('exits 1 on an unknown flag', () => {
    const path = writeDoc();
    const r = run([`--file=${path}`, '--sections=Module Organization']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown flag/);
  });
});
