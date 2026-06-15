// tests/unit/investigate.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { slugify, parseArgs } from '../../bin/investigate.mjs';
import { renderFrontmatter, renderRound, bumpFrontmatter } from '../../bin/investigate.mjs';
import { resolveNote } from '../../bin/investigate.mjs';

describe('slugify', () => {
  test('lowercases, hyphenates, strips symbols, caps at 40', () => {
    const s = slugify('¿gRPC vs REST a escala?? Sí ' + 'x'.repeat(100));
    assert.match(s, /^[a-z0-9-]+$/);
    assert.ok(s.length <= 40);
    assert.ok(!s.startsWith('-') && !s.endsWith('-'));
  });

  test('same topic yields the same slug (deterministic resume key)', () => {
    assert.equal(slugify('gRPC vs REST'), slugify('gRPC vs REST'));
  });
});

describe('parseArgs', () => {
  test('topic positional, engine defaults to perplexity', () => {
    const a = parseArgs(['¿X?']);
    assert.equal(a.topic, '¿X?');
    assert.equal(a.engine, 'perplexity');
  });

  test('--engine fusion is honored', () => {
    const a = parseArgs(['¿X?', '--engine', 'fusion']);
    assert.equal(a.engine, 'fusion');
  });

  test('rejects unknown engine', () => {
    assert.throws(() => parseArgs(['¿X?', '--engine', 'bogus']), /unknown engine/);
  });
});

describe('renderFrontmatter', () => {
  test('renders a new note header with one engine', () => {
    const fm = renderFrontmatter({
      title: 'gRPC vs REST', slug: 'grpc-vs-rest', engines: ['perplexity'], today: '2026-06-15',
    });
    assert.match(fm, /^---\n/);
    assert.match(fm, /slug: grpc-vs-rest/);
    assert.match(fm, /engines: \[perplexity\]/);
    assert.match(fm, /status: open/);
    assert.match(fm, /created: 2026-06-15/);
    assert.match(fm, /updated: 2026-06-15/);
  });
});

describe('bumpFrontmatter', () => {
  test('adds a new engine and bumps updated, never duplicates', () => {
    const fm = renderFrontmatter({ title: 'T', slug: 't', engines: ['perplexity'], today: '2026-06-15' });
    const bumped = bumpFrontmatter(fm, { engine: 'fusion', today: '2026-06-16' });
    assert.match(bumped, /engines: \[perplexity, fusion\]/);
    assert.match(bumped, /updated: 2026-06-16/);
    const again = bumpFrontmatter(bumped, { engine: 'fusion', today: '2026-06-17' });
    assert.match(again, /engines: \[perplexity, fusion\]/);
    assert.match(again, /updated: 2026-06-17/);
  });
});

describe('renderRound', () => {
  test('renders a round with question, engine, answer, sources', () => {
    const r = renderRound({
      n: 2, today: '2026-06-15', engine: 'fusion',
      question: '¿costo?', answer: 'depende',
      sources: [{ title: 'Doc', url: 'https://x.test' }],
    });
    assert.match(r, /## Round 2 — 2026-06-15 · fusion/);
    assert.match(r, /\*\*Pregunta:\*\* ¿costo\?/);
    assert.match(r, /\*\*Respuesta:\*\* depende/);
    assert.match(r, /- Doc — https:\/\/x\.test/);
  });

  test('zero sources renders the unverified marker', () => {
    const r = renderRound({ n: 1, today: '2026-06-15', engine: 'perplexity', question: 'q', answer: 'a', sources: [] });
    assert.match(r, /sin fuentes — no verificado/);
  });
});

describe('resolveNote', () => {
  const obsAvailable = (cmd) => (cmd === 'command' ? { status: 0, stdout: '/usr/bin/obs' } : { status: 0, stdout: '' });
  const obsMissing = () => ({ status: 1, stdout: '' });

  test('obs present → storage obs, vault path', () => {
    const note = resolveNote({ slug: 'grpc-vs-rest', execImpl: obsAvailable, fsImpl: { existsSync: () => false }, cwd: '/w' });
    assert.equal(note.storage, 'obs');
    assert.equal(note.notePath, 'Resources/Investigations/grpc-vs-rest.md');
  });

  test('obs absent → storage local, cwd path', () => {
    const note = resolveNote({ slug: 'grpc-vs-rest', execImpl: obsMissing, fsImpl: { existsSync: () => false }, cwd: '/w' });
    assert.equal(note.storage, 'local');
    assert.equal(note.notePath, '/w/investigations/grpc-vs-rest.md');
  });

  test('local existing note → exists true', () => {
    const note = resolveNote({ slug: 's', execImpl: obsMissing, fsImpl: { existsSync: () => true }, cwd: '/w' });
    assert.equal(note.exists, true);
  });
});
