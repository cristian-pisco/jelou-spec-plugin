// tests/pressure/opencode-parity.test.mjs
//
// Pressure test: every JLU dev-orchestrator skill ships its three runtime
// files, and the diagnoser agent ships in both runtimes.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DEV_ORCHESTRATOR_SKILLS = [
  'register-service',
  'start-dev',
  'stop-dev',
  'add-service',
  'diagnose',
  'logs',
  'add-failure-pattern'
];

function readFm(path) {
  const body = readFileSync(path, 'utf8');
  const m = body.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`no frontmatter in ${path}`);
  return m[1];
}

describe('dev-orchestrator skills — full trio per skill', () => {
  for (const name of DEV_ORCHESTRATOR_SKILLS) {
    test(`${name}: skill + workflow + opencode all present`, () => {
      const skill = join(ROOT, 'skills', name, 'SKILL.md');
      const workflow = join(ROOT, 'jelou', 'workflows', `${name}.md`);
      const opencode = join(ROOT, '.opencode', 'commands', `jlu-${name}.md`);
      assert.equal(existsSync(skill), true, `missing ${skill}`);
      assert.equal(existsSync(workflow), true, `missing ${workflow}`);
      assert.equal(existsSync(opencode), true, `missing ${opencode}`);
    });

    test(`${name}: skill frontmatter has name + description + allowed-tools`, () => {
      const skill = join(ROOT, 'skills', name, 'SKILL.md');
      const fm = readFm(skill);
      assert.match(fm, new RegExp(`name:\\s*${name}\\s*$`, 'm'));
      assert.match(fm, /description:/);
      assert.match(fm, /allowed-tools:/);
    });

    test(`${name}: opencode command frontmatter has agent: build`, () => {
      const opencode = join(ROOT, '.opencode', 'commands', `jlu-${name}.md`);
      const fm = readFm(opencode);
      assert.match(fm, /agent:\s*build/);
    });
  }
});

describe('jlu-dev-diagnoser agent — dual-published', () => {
  test('claude code agents/jlu-dev-diagnoser.md exists', () => {
    assert.equal(existsSync(join(ROOT, 'agents', 'jlu-dev-diagnoser.md')), true);
  });

  test('opencode .opencode/agents/jlu-dev-diagnoser.md exists', () => {
    assert.equal(existsSync(join(ROOT, '.opencode', 'agents', 'jlu-dev-diagnoser.md')), true);
  });
});
