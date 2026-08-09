import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ORPHAN_ALLOWLIST = {
  'jlu-dev-diagnoser':
    'Dev-environment triage agent kept for start-dev; the /jlu-diagnose workflow that dispatched it was retired.',
  'jlu-architecture-explorer':
    'Architecture-review agent kept while the retired /jlu-architecture-review workflow is reabsorbed.',
  'jlu-architecture-grill':
    'Architecture-review agent kept while the retired /jlu-architecture-review workflow is reabsorbed.',
};

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

describe('the spec author dispatch passes only variables the workflow defines', () => {
  const wf = readFileSync(join(ROOT, 'jelou/workflows/new-task.md'), 'utf8');
  const dispatchTable = wf.slice(
    wf.indexOf('### 14c — Dispatch the spec author'),
    wf.indexOf('### 14d'),
  );

  function tableVariables() {
    return [...new Set([...dispatchTable.matchAll(/^\|\s*`([A-Z_]{4,})`/gm)].map((m) => m[1]))];
  }

  test('every variable handed to the agent is produced by an earlier step', () => {
    const undefinedVars = tableVariables().filter((name) => {
      const outsideTable = wf.split(dispatchTable).join('');
      return !new RegExp(`\\b${name}\\b`).test(outsideTable);
    });

    assert.deepEqual(
      undefinedVars,
      [],
      `14c hands the spec author variables no step defines: ${undefinedVars.join(', ')}. ` +
        `A dispatch prompt naming a variable that does not exist silently loses that input.`,
    );
  });

  test('INTERVIEW_ANSWERS is stored in both the interactive and the autonomous branch', () => {
    const interview = wf.slice(wf.indexOf('### 14b'), wf.indexOf('### 14c'));
    const stores = [...interview.matchAll(/\*\*Store\*\*:\s*`INTERVIEW_ANSWERS`/g)];

    assert.ok(
      stores.length >= 2,
      'INTERVIEW_ANSWERS must be stored by 14b (interactive) and 14b-auto (autonomous); ' +
        `found ${stores.length} store site(s). An autonomous run with no store hands the ` +
        'author an empty set and gets a spec written from the bare seed.',
    );
  });
});
