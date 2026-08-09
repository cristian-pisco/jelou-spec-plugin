import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ORPHAN_ALLOWLIST = {};

function agentNames() {
  return readdirSync(join(ROOT, 'agents'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
}

function walk(dir, ext, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, ext, acc);
    else if (full.endsWith(ext)) acc.push(full);
  }
  return acc;
}

function callerCorpus() {
  return [
    ...walk(join(ROOT, 'jelou/workflows'), '.md'),
    ...walk(join(ROOT, 'skills'), '.md'),
  ].map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));
}

function referencedIn(name, corpus) {
  const pattern = new RegExp(`\\b${name}\\b`);
  return corpus.filter(({ text }) => pattern.test(text)).map(({ file }) => file);
}

describe('every defined agent is reachable from a workflow or skill', () => {
  const corpus = callerCorpus();

  test('an agent that no caller names is dead code, and a rule written into it never runs', () => {
    const orphans = agentNames().filter(
      (name) => referencedIn(name, corpus).length === 0 && !(name in ORPHAN_ALLOWLIST),
    );

    assert.deepEqual(
      orphans,
      [],
      `Unreachable agents: ${orphans.join(', ')}. Either dispatch each from a workflow or ` +
        `skill, or add it to ORPHAN_ALLOWLIST with the reason it is kept.`,
    );
  });

  test('the allowlist holds only agents that really have no caller', () => {
    const stale = Object.keys(ORPHAN_ALLOWLIST).filter(
      (name) => referencedIn(name, corpus).length > 0,
    );

    assert.deepEqual(
      stale,
      [],
      `Allowlisted agents that are in fact referenced: ${stale.join(', ')}. Remove them from ` +
        `ORPHAN_ALLOWLIST so a future orphan is caught.`,
    );
  });

  test('allowlisted agents carry a non-empty reason', () => {
    const unexplained = Object.entries(ORPHAN_ALLOWLIST)
      .filter(([, reason]) => !reason || !reason.trim())
      .map(([name]) => name);

    assert.deepEqual(unexplained, [], `Allowlisted without a reason: ${unexplained.join(', ')}`);
  });
});

describe('the spec author is dispatched, not inlined', () => {
  test('new-task dispatches jlu-spec-interviewer instead of writing SPEC.md itself', () => {
    const wf = readFileSync(join(ROOT, 'jelou/workflows/new-task.md'), 'utf8');

    assert.match(wf, /\bjlu-spec-interviewer\b/);
    assert.match(wf, /### 14c — Dispatch the spec author/);
  });

  test('the spec author cannot ask the user, because the interview stays inline', () => {
    const agent = readFileSync(join(ROOT, 'agents/jlu-spec-interviewer.md'), 'utf8');
    const frontmatter = agent.slice(0, agent.indexOf('---', 3));

    assert.doesNotMatch(frontmatter, /AskUserQuestion/);
  });

  test('the story fusion rule lives where stories are authored', () => {
    const agent = readFileSync(join(ROOT, 'agents/jlu-spec-interviewer.md'), 'utf8');

    assert.match(agent, /Story fusion criterion/);
  });
});
