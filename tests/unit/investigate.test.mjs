// tests/unit/investigate.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { slugify, parseArgs } from '../../bin/investigate.mjs';
import { renderFrontmatter, renderRound, bumpFrontmatter } from '../../bin/investigate.mjs';
import { resolveNote } from '../../bin/investigate.mjs';
import { createServer } from 'node:http';
import { after } from 'node:test';
import { runFusion } from '../../bin/investigate.mjs';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import { persistRound } from '../../bin/investigate.mjs';
import { buildNoteContent } from '../../bin/investigate.mjs';
import { renderParts } from '../../bin/investigate.mjs';
import { fileURLToPath } from 'node:url';

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
    assert.match(r, /\*\*Question:\*\* ¿costo\?/);
    assert.match(r, /\*\*Answer:\*\* depende/);
    assert.match(r, /- Doc — https:\/\/x\.test/);
  });

  test('zero sources renders the unverified marker', () => {
    const r = renderRound({ n: 1, today: '2026-06-15', engine: 'perplexity', question: 'q', answer: 'a', sources: [] });
    assert.match(r, /no sources — unverified/);
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

  test('obs present + matching filename listed → exists true', () => {
    const exec = (cmd, args) => {
      if (cmd === 'command') return { status: 0, stdout: '/usr/bin/obs' };
      if (cmd === 'obs' && args[0] === 'files') return { status: 0, stdout: 'Resources/Investigations/grpc-vs-rest.md\nResources/Investigations/other.md' };
      return { status: 0, stdout: '' };
    };
    const note = resolveNote({ slug: 'grpc-vs-rest', execImpl: exec, fsImpl: { existsSync: () => false }, cwd: '/w' });
    assert.equal(note.exists, true);
  });

  test('obs present + only a substring-superset filename → exists false (no false positive)', () => {
    const exec = (cmd, args) => {
      if (cmd === 'command') return { status: 0, stdout: '/usr/bin/obs' };
      if (cmd === 'obs' && args[0] === 'files') return { status: 0, stdout: 'Resources/Investigations/foo-grpc-vs-rest.md' };
      return { status: 0, stdout: '' };
    };
    const note = resolveNote({ slug: 'grpc-vs-rest', execImpl: exec, fsImpl: { existsSync: () => false }, cwd: '/w' });
    assert.equal(note.exists, false);
  });
});

describe('runFusion against a mocked OpenRouter', () => {
  let server, baseUrl;
  const start = () => new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = ''; req.on('data', (c) => (body += c));
      req.on('end', () => {
        const { model } = JSON.parse(body);
        if (model === 'openrouter/fusion') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: {
            content: 'fused answer',
            annotations: [{ type: 'url_citation', url_citation: { title: 'Spec', url: 'https://s.test' } }],
          } }] }));
        } else { res.writeHead(500); res.end('boom'); }
      });
    });
    server.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); });
  });
  after(() => server?.close());

  test('ok → answer + sources from annotations', async () => {
    await start();
    const r = await runFusion({ topic: '¿X?', apiKey: 'k', baseUrl, timeoutMs: 5000 });
    assert.equal(r.ok, true);
    assert.equal(r.answer, 'fused answer');
    assert.deepEqual(r.sources, [{ title: 'Spec', url: 'https://s.test' }]);
  });

  test('http error → structured envelope, never throws', async () => {
    const r = await runFusion({ topic: '¿X?', apiKey: 'k', baseUrl, timeoutMs: 5000, model: 'broken' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 'http_error');
  });

  test('missing api key → clear error', async () => {
    const r = await runFusion({ topic: '¿X?', apiKey: '', baseUrl, timeoutMs: 5000 });
    assert.equal(r.ok, false);
    assert.match(r.error, /OPENROUTER_API_KEY/);
  });
});

describe('persistRound (local storage)', () => {
  test('creates a new note with frontmatter + Round 1', () => {
    const dir = mkdtempSync(pjoin(tmpdir(), 'inv-'));
    const notePath = pjoin(dir, 'investigations', 't.md');
    persistRound({
      storage: 'local', notePath, exists: false,
      slug: 't', title: 'T', engine: 'perplexity', today: '2026-06-15',
      question: 'q', answer: 'a', sources: [{ title: 'D', url: 'https://d.test' }],
    });
    const body = readFileSync(notePath, 'utf8');
    assert.match(body, /slug: t/);
    assert.match(body, /## Round 1 — 2026-06-15 · perplexity/);
  });

  test('appends Round 2 to an existing note and bumps engines', () => {
    const dir = mkdtempSync(pjoin(tmpdir(), 'inv-'));
    const notePath = pjoin(dir, 'investigations', 't.md');
    persistRound({ storage: 'local', notePath, exists: false, slug: 't', title: 'T', engine: 'perplexity', today: '2026-06-15', question: 'q1', answer: 'a1', sources: [] });
    persistRound({ storage: 'local', notePath, exists: true, slug: 't', title: 'T', engine: 'fusion', today: '2026-06-16', question: 'q2', answer: 'a2', sources: [] });
    const body = readFileSync(notePath, 'utf8');
    assert.match(body, /engines: \[perplexity, fusion\]/);
    assert.match(body, /## Round 1 /);
    assert.match(body, /## Round 2 /);
    assert.match(body, /updated: 2026-06-16/);
  });

  test('round number ignores "## Round N" appearing inside an answer body', () => {
    const dir = mkdtempSync(pjoin(tmpdir(), 'inv-'));
    const notePath = pjoin(dir, 'investigations', 't.md');
    persistRound({ storage: 'local', notePath, exists: false, slug: 't', title: 'T', engine: 'perplexity', today: '2026-06-15', question: 'q', answer: 'see ## Round 99 below', sources: [] });
    persistRound({ storage: 'local', notePath, exists: true, slug: 't', title: 'T', engine: 'fusion', today: '2026-06-16', question: 'q2', answer: 'a2', sources: [] });
    const body = readFileSync(notePath, 'utf8');
    assert.match(body, /## Round 2 — 2026-06-16 · fusion/);
    assert.doesNotMatch(body, /## Round 100/);
  });

  test('resuming a note that lost its frontmatter prepends a fresh header', () => {
    const dir = mkdtempSync(pjoin(tmpdir(), 'inv-'));
    const notePath = pjoin(dir, 'investigations', 't.md');
    mkdirSync(pjoin(dir, 'investigations'), { recursive: true });
    writeFileSync(notePath, '## Round 1 — 2026-06-10 · perplexity\n\n**Answer:** old\n');
    persistRound({ storage: 'local', notePath, exists: true, slug: 't', title: 'T', engine: 'fusion', today: '2026-06-16', question: 'q', answer: 'a', sources: [] });
    const body = readFileSync(notePath, 'utf8');
    assert.match(body, /^---\n/);
    assert.match(body, /## Round 2 — 2026-06-16 · fusion/);
  });
});

describe('buildNoteContent', () => {
  test('new note: frontmatter + Round 1', () => {
    const c = buildNoteContent({ existingContent: '', exists: false, slug: 't', title: 'T', engine: 'perplexity', today: '2026-06-15', question: 'q', answer: 'a', sources: [] });
    assert.match(c, /^---\n/);
    assert.match(c, /## Round 1 — 2026-06-15 · perplexity/);
  });

  test('append with frontmatter: Round 2 + engines bumped', () => {
    const first = buildNoteContent({ existingContent: '', exists: false, slug: 't', title: 'T', engine: 'perplexity', today: '2026-06-15', question: 'q1', answer: 'a1', sources: [] });
    const second = buildNoteContent({ existingContent: first, exists: true, slug: 't', title: 'T', engine: 'fusion', today: '2026-06-16', question: 'q2', answer: 'a2', sources: [] });
    assert.match(second, /engines: \[perplexity, fusion\]/);
    assert.match(second, /## Round 1 /);
    assert.match(second, /## Round 2 — 2026-06-16 · fusion/);
    assert.match(second, /updated: 2026-06-16/);
  });

  test('append to a note that lost its frontmatter prepends a fresh header', () => {
    const c = buildNoteContent({ existingContent: '## Round 1 — 2026-06-10 · perplexity\n\n**Answer:** old\n', exists: true, slug: 't', title: 'T', engine: 'fusion', today: '2026-06-16', question: 'q', answer: 'a', sources: [] });
    assert.match(c, /^---\n/);
    assert.match(c, /## Round 2 — 2026-06-16 · fusion/);
  });
});

describe('renderParts (obs append support)', () => {
  test('new note: fullNote with Round 1, engines [engine]', () => {
    const p = renderParts({ existingContent: '', exists: false, slug: 't', title: 'T', engine: 'perplexity', today: '2026-06-15', question: 'q', answer: 'a', sources: [] });
    assert.match(p.fullNote, /## Round 1 — 2026-06-15 · perplexity/);
    assert.deepEqual(p.engines, ['perplexity']);
    assert.match(p.roundBlock, /## Round 1 /);
    assert.equal(p.updated, '2026-06-15');
  });

  test('resume: roundBlock is Round 2, engines merged, updated bumped', () => {
    const first = renderParts({ existingContent: '', exists: false, slug: 't', title: 'T', engine: 'perplexity', today: '2026-06-15', question: 'q1', answer: 'a1', sources: [] }).fullNote;
    const p = renderParts({ existingContent: first, exists: true, slug: 't', title: 'T', engine: 'fusion', today: '2026-06-16', question: 'q2', answer: 'a2', sources: [] });
    assert.match(p.roundBlock, /## Round 2 — 2026-06-16 · fusion/);
    assert.deepEqual(p.engines, ['perplexity', 'fusion']);
    assert.equal(p.updated, '2026-06-16');
    assert.doesNotMatch(p.roundBlock, /## Round 1 /);
  });

  test('resume with same engine does not duplicate it in engines', () => {
    const first = renderParts({ existingContent: '', exists: false, slug: 't', title: 'T', engine: 'perplexity', today: '2026-06-15', question: 'q1', answer: 'a1', sources: [] }).fullNote;
    const p = renderParts({ existingContent: first, exists: true, slug: 't', title: 'T', engine: 'perplexity', today: '2026-06-16', question: 'q2', answer: 'a2', sources: [] });
    assert.deepEqual(p.engines, ['perplexity']);
  });
});
