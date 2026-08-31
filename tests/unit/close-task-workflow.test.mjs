import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('close-task workflow — Step 3a.d closure comment', () => {
  const wf = read('jelou/workflows/close-task.md');

  test('references the closure-comment template', () => {
    assert.match(wf, /jelou\/templates\/closure-comment\.md/);
  });

  test('mandates English', () => {
    assert.match(wf, /Language:\s*\*\*English\*\*/);
  });

  test('forbids PR URLs in the closure comment', () => {
    assert.match(wf, /Do NOT include[\s\S]{0,400}PR URLs/);
    assert.match(wf, /already posted by `\/jlu-ship`/);
  });

  test('forbids signature lines and ISO timestamps in the closure comment', () => {
    assert.match(wf, /signature lines/);
    assert.match(wf, /ISO timestamps/);
  });

  test('forbids internal slugs / IDs / paths / service IDs in code form', () => {
    assert.match(wf, /internal slugs \/ IDs \/ file paths \/ branch names/);
    assert.match(wf, /service IDs in code form/);
  });

  test('requires natural prose, no Markdown formatting beyond paragraph breaks', () => {
    assert.match(wf, /natural prose/);
    assert.match(wf, /no Markdown formatting beyond paragraph\s+breaks/);
  });

  test('caps summary length and makes follow-up paragraph optional', () => {
    assert.match(wf, /summary \(2–5 sentences\)/);
    assert.match(wf, /optional 1\s+paragraph future improvements/);
    assert.match(wf, /never invented/);
  });

  test('explicitly lists the source material the LLM must read', () => {
    assert.match(wf, /SPEC\.md.*Problem Statement, FRs/);
    assert.match(wf, /PROPOSAL\.md.*Strategy/);
    assert.match(wf, /TASKS\.md.*phase outcomes, deferred items/);
  });
});

describe('closure-comment template', () => {
  const tmpl = read('jelou/templates/closure-comment.md');

  test('mandates English language', () => {
    assert.match(tmpl, /\*\*Language: English\.\*\*/);
    assert.match(tmpl, /Never Spanish/);
  });

  test('mandates natural-language tone', () => {
    assert.match(tmpl, /\*\*Tone: natural language\.\*\*/);
  });

  test('defines the two-paragraph structure (summary + optional follow-up)', () => {
    assert.match(tmpl, /\*\*Summary\*\* \(required\) — 2 to 5 sentences/);
    assert.match(tmpl, /\*\*Future improvements\*\* \(optional\)/);
  });

  test('forbids inventing follow-ups', () => {
    assert.match(tmpl, /\*\*Never invent follow-ups\*\*/);
  });

  test('lists the hard prohibitions verbatim', () => {
    const phrases = [
      '**PR URLs or PR numbers.**',
      '**Signature line**',
      '**Test counts**',
      '**Phase counts**',
      '**Internal slugs, IDs, or branch names**',
      '**File paths or symbol names**',
      '**Service IDs in code form**',
      '**ISO-8601 timestamps**',
      '**Markdown formatting tokens** beyond paragraph breaks',
    ];
    for (const phrase of phrases) {
      assert.ok(
        tmpl.includes(phrase),
        `template missing prohibition: ${phrase}`
      );
    }
  });

  test('shows at least one good example and one bad example', () => {
    assert.match(tmpl, /### Good —/);
    assert.match(tmpl, /### Bad —/);
  });

  test('the bad example contains exactly the noise we want to ban', () => {
    assert.match(tmpl, /Task closed at /);
    assert.match(tmpl, /PRs merged:/);
    assert.match(tmpl, /697 tests passing/);
  });

  test('points to SPEC / PROPOSAL / TASKS as source material', () => {
    assert.match(tmpl, /SPEC\.md/);
    assert.match(tmpl, /PROPOSAL\.md/);
    assert.match(tmpl, /TASKS\.md/);
  });
});
