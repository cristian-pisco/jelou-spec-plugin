import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compareInventory,
  extractJsonObject,
  liveProbe,
  main,
  parseArgs,
  verify,
} from '../../bin/verify-plugin-load.mjs';

const ids = (findings) => findings.map((f) => f.id).sort();
const errors = (result) => ids(result.findings.filter((f) => f.severity === 'error'));

function fixture({ hooks } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'jlu-verify-'));
  const manifest = { name: 'jlu', version: '1.0.0' };
  if (hooks !== undefined) manifest.hooks = hooks;
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify(manifest));
  mkdirSync(join(root, 'skills/ship'), { recursive: true });
  writeFileSync(join(root, 'skills/ship/SKILL.md'), '---\nname: ship\ndescription: ships\n---\n\nbody\n');
  mkdirSync(join(root, 'agents'), { recursive: true });
  writeFileSync(join(root, 'agents/jlu-tdd-cycle.md'), '---\nname: jlu-tdd-cycle\ndescription: cycles\n---\n\nbody\n');
  return root;
}

const cliAbsent = () => ({ ok: false, stdout: '', error: 'claude: not found' });
const cliPasses = () => ({ ok: true, stdout: 'Validation passed\n' });
const cliRejects = () => ({ ok: false, stdout: '✖ Validation failed: bad manifest\n' });

describe('the gate catches what shipped in 0.3.359', () => {
  test('a hooks field pointing at the auto-loaded hooks.json fails the gate', () => {
    const root = fixture({ hooks: './hooks/hooks.json' });
    assert.deepEqual(errors(verify({ root, runner: cliAbsent, home: '/nonexistent' })), ['hooks-duplicate']);
    rmSync(root, { recursive: true, force: true });
  });

  test('the same tree without that field passes', () => {
    const root = fixture();
    assert.deepEqual(errors(verify({ root, runner: cliAbsent, home: '/nonexistent' })), []);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('offline by default so CI never depends on the Claude CLI', () => {
  test('an absent CLI skips validation instead of failing', () => {
    const root = fixture();
    const result = verify({ root, runner: cliAbsent, home: '/nonexistent' });
    assert.equal(result.validation.available, false);
    assert.deepEqual(errors(result), []);
    rmSync(root, { recursive: true, force: true });
  });

  test('a CLI that rejects the manifest fails the gate', () => {
    const root = fixture();
    assert.deepEqual(errors(verify({ root, runner: cliRejects, home: '/nonexistent' })), ['cli-validate-failed']);
    rmSync(root, { recursive: true, force: true });
  });

  test('a CLI that accepts the manifest adds nothing', () => {
    const root = fixture();
    const result = verify({ root, runner: cliPasses, home: '/nonexistent' });
    assert.equal(result.validation.passed, true);
    assert.deepEqual(errors(result), []);
    rmSync(root, { recursive: true, force: true });
  });

  test('shadow copies are advisory, never a release blocker', () => {
    const root = fixture();
    const home = mkdtempSync(join(tmpdir(), 'jlu-verify-home-'));
    mkdirSync(join(home, '.claude/skills/ship'), { recursive: true });
    writeFileSync(join(home, '.claude/skills/ship/SKILL.md'), '---\nname: ship\ndescription: d\n---\n\njelou/workflows/ship.md\n');
    const result = verify({ root, runner: cliAbsent, home });
    assert.deepEqual(errors(result), []);
    assert.deepEqual(ids(result.advisories), ['skill-shadow-current']);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
});

describe('the live probe compares what a session sees against what the tree declares', () => {
  test('a session missing a declared skill or agent fails the gate', () => {
    const findings = compareInventory(
      { skills: ['ship', 'goal'], agents: ['jlu-tdd-cycle'] },
      { skills: ['ship'], agents: [] },
    );
    assert.deepEqual(ids(findings), ['live-agents-missing', 'live-skills-missing']);
    assert.match(findings.find((f) => f.id === 'live-skills-missing').message, /goal/);
  });

  test('a session seeing undeclared surfaces warns about a lingering install', () => {
    const findings = compareInventory({ skills: ['ship'], agents: [] }, { skills: ['ship', 'rollback-phase'], agents: [] });
    assert.deepEqual(ids(findings), ['live-skills-extra']);
    assert.equal(findings[0].severity, 'warn');
  });

  test('a matching session produces nothing', () => {
    assert.deepEqual(compareInventory({ skills: ['ship'], agents: ['a'] }, { skills: ['ship'], agents: ['a'] }), []);
  });

  test('the probe reads JSON even when the model wraps it in prose or a fence', () => {
    assert.deepEqual(extractJsonObject('Here you go:\n```json\n{"skills":["ship"]}\n```\n'), { skills: ['ship'] });
    assert.deepEqual(extractJsonObject('{"skills":[]}'), { skills: [] });
    assert.equal(extractJsonObject('no json here'), null);
    assert.equal(extractJsonObject('{broken'), null);
  });

  test('a probe session that cannot start is unavailable, not a pass', () => {
    const root = fixture();
    const result = liveProbe({ root, exec: () => { throw new Error('claude: not found'); } });
    assert.equal(result.available, false);
    rmSync(root, { recursive: true, force: true });
  });

  test('a probe session that answers is compared against the tree', () => {
    const root = fixture();
    const result = liveProbe({ root, exec: () => '{"skills":["ship"],"agents":["jlu-tdd-cycle"]}' });
    assert.equal(result.available, true);
    assert.deepEqual(result.findings, []);
    rmSync(root, { recursive: true, force: true });
  });

  test('the probe is opt-in — the default run never spends a model call', () => {
    const root = fixture();
    let called = false;
    const result = verify({ root, runner: cliAbsent, home: '/nonexistent', exec: () => { called = true; return ''; } });
    assert.equal(called, false);
    assert.equal(result.probe.available, false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('CLI contract', () => {
  test('options parse and unknown ones are rejected', () => {
    assert.equal(parseArgs([]).live, false);
    assert.equal(parseArgs(['--live']).live, true);
    assert.equal(parseArgs(['--json']).json, true);
    assert.match(parseArgs(['--nope']).error, /unknown option/);
  });

  test('exit code is 1 on a defect, 0 on a clean tree, 2 on misuse', () => {
    const broken = fixture({ hooks: './hooks/hooks.json' });
    const clean = fixture();
    const sink = () => {};
    assert.equal(main(['--root', broken], { out: sink, runner: cliAbsent }), 1);
    assert.equal(main(['--root', clean], { out: sink, runner: cliAbsent }), 0);
    assert.equal(main(['--nope'], { out: sink, runner: cliAbsent }), 2);
    rmSync(broken, { recursive: true, force: true });
    rmSync(clean, { recursive: true, force: true });
  });

  test('the failure output names the defect and its fix', () => {
    const root = fixture({ hooks: './hooks/hooks.json' });
    const lines = [];
    main(['--root', root], { out: (s) => lines.push(s), runner: cliAbsent });
    const text = lines.join('\n');
    assert.match(text, /FAIL/);
    assert.match(text, /hooks-duplicate/);
    assert.match(text, /Drop the "hooks" field/);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('this repository passes its own gate', () => {
  test('the working tree loads', () => {
    assert.deepEqual(errors(verify({ root: process.cwd(), runner: cliAbsent, home: '/nonexistent' })), []);
  });
});
