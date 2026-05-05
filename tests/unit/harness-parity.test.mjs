// tests/unit/harness-parity.test.mjs
//
// Run: `node --test tests/unit/harness-parity.test.mjs`
// Node 20+ required.
//
// Validates that the plugin's harness layers (skills, workflows, OpenCode
// commands, agents) stay in lockstep. Any rename without cross-update will
// fail this suite.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function listSkills() {
  const dir = join(ROOT, 'skills');
  return readdirSync(dir).filter(
    (name) =>
      statSync(join(dir, name)).isDirectory() &&
      existsSync(join(dir, name, 'SKILL.md')),
  );
}

function listWorkflows() {
  return readdirSync(join(ROOT, 'jelou/workflows'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
}

function listOpencodeCommands() {
  const dir = join(ROOT, '.opencode/commands');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, '').replace(/^jlu-/, ''));
}

describe('harness parity — skills ↔ workflows ↔ commands', () => {
  test('every skill has a matching workflow', () => {
    const skills = listSkills();
    const workflows = new Set(listWorkflows());
    const missing = skills.filter((s) => !workflows.has(s));
    assert.deepEqual(
      missing,
      [],
      `Skills without workflows in jelou/workflows/: ${missing.join(', ')}`,
    );
  });

  test('every workflow has a matching skill', () => {
    const skills = new Set(listSkills());
    const workflows = listWorkflows();
    const missing = workflows.filter((w) => !skills.has(w));
    assert.deepEqual(
      missing,
      [],
      `Workflows without skills in skills/: ${missing.join(', ')}`,
    );
  });

  test('every OpenCode command has a matching skill', () => {
    const skills = new Set(listSkills());
    const commands = listOpencodeCommands();
    const missing = commands.filter((c) => !skills.has(c));
    assert.deepEqual(
      missing,
      [],
      `OpenCode commands without skills: ${missing.join(', ')}`,
    );
  });

  test('every agent in agents/ has a synced .opencode/agents counterpart', () => {
    const sourceDir = join(ROOT, 'agents');
    const destDir = join(ROOT, '.opencode/agents');
    const sources = readdirSync(sourceDir).filter((f) => f.endsWith('.md'));
    const missing = sources.filter((f) => !existsSync(join(destDir, f)));
    assert.deepEqual(
      missing,
      [],
      `Agents not synced (run: node bin/sync-agents.mjs): ${missing.join(', ')}`,
    );
  });

  test('no orphan files in .opencode/agents/', () => {
    const sourceDir = join(ROOT, 'agents');
    const destDir = join(ROOT, '.opencode/agents');
    const sources = new Set(
      readdirSync(sourceDir).filter((f) => f.endsWith('.md')),
    );
    const orphans = readdirSync(destDir)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => !sources.has(f));
    assert.deepEqual(
      orphans,
      [],
      `Orphan .opencode/agents/ files (no source in agents/): ${orphans.join(', ')}`,
    );
  });
});
