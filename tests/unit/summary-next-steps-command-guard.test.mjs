// tests/unit/summary-next-steps-command-guard.test.mjs
//
// Run: `node --test tests/unit/summary-next-steps-command-guard.test.mjs`
//
// jlu-summary-agent prints a "Next Steps" block at the end of execution. The
// canonical guidance is `/jlu:ship` → `/jlu:close-task`, but a run was observed
// emitting `/jlu:land-and-deploy` — a command that does not exist (it conflated
// gstack's `land-and-deploy` into the jlu namespace, and invented a command for
// deferred deploy-time work). The runtime guard is the closed-vocabulary rule in
// the agent prompt; this suite guards the source: no canonical doc may name a
// `/jlu:*` command that does not resolve to a real skill, and the summary agent
// must keep carrying the closed-vocabulary guardrail.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const realCommands = new Set(
  readdirSync(join(ROOT, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name),
);

// Matches a slash-command invocation `/jlu:<name>` or `/jlu-<name>` and captures
// the bare command name. Mirrors the bash audit used to vet the current source.
const CMD_RE = /\/jlu[:-]([a-z][a-z-]+)/g;

function commandRefs(src) {
  return [...src.matchAll(CMD_RE)].map((m) => m[1]);
}

function mdFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mdFilesUnder(p));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const SUMMARY_AGENT = join(ROOT, 'agents', 'jlu-summary-agent.md');

describe('summary agent — closed /jlu:* command vocabulary', () => {
  const src = readFileSync(SUMMARY_AGENT, 'utf8');

  test('every /jlu command it names resolves to a real skill', () => {
    const phantoms = [...new Set(commandRefs(src))].filter((c) => !realCommands.has(c));
    assert.deepEqual(
      phantoms,
      [],
      `jlu-summary-agent names commands that do not exist: ${phantoms.map((c) => `/jlu:${c}`).join(', ')}`,
    );
  });

  test('it still canonically points at /jlu:ship then /jlu:close-task', () => {
    const refs = commandRefs(src);
    assert.ok(refs.includes('ship'), 'must reference /jlu:ship');
    assert.ok(refs.includes('close-task'), 'must reference /jlu:close-task');
  });

  test('it carries the closed-vocabulary guardrail (cannot be silently dropped)', () => {
    assert.match(
      src,
      /vocabulary is closed/i,
      'the "Never invent commands. The /jlu:* vocabulary is closed." guardrail must remain',
    );
    assert.match(
      src,
      /there is no `jlu:land-and-deploy` command/i,
      'the land-and-deploy negative example anchors the regression and must remain',
    );
    assert.match(
      src,
      /plain-prose manual\/ops step/i,
      'deploy-time work must be documented as a prose step, not an invented command',
    );
  });
});

describe('plugin-wide — no canonical doc references a phantom /jlu command', () => {
  const docs = [...mdFilesUnder(join(ROOT, 'agents')), ...mdFilesUnder(join(ROOT, 'skills'))];

  test('the doc set is non-trivial', () => {
    assert.ok(docs.length >= 30, `expected to scan many docs, got ${docs.length}`);
  });

  test('every /jlu:<name> mentioned across agents/ and skills/ is a real skill', () => {
    const offenders = [];
    for (const file of docs) {
      const phantoms = [...new Set(commandRefs(readFileSync(file, 'utf8')))].filter(
        (c) => !realCommands.has(c),
      );
      for (const c of phantoms) {
        offenders.push(`${file.slice(ROOT.length + 1)}: /jlu:${c}`);
      }
    }
    assert.deepEqual(offenders, [], `Phantom /jlu commands referenced:\n${offenders.join('\n')}`);
  });
});
