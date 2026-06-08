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

function listCodexPrompts() {
  const dir = join(ROOT, '.codex/prompts');
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

  test('every skill has a matching OpenCode command', () => {
    const skills = listSkills();
    const commands = new Set(listOpencodeCommands());
    const missing = skills.filter((s) => !commands.has(s));
    assert.deepEqual(
      missing,
      [],
      `Skills without OpenCode commands (.opencode/commands/jlu-<skill>.md): ${missing.join(', ')}`,
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

describe('harness parity — Codex mirror (.codex/)', () => {
  test('every skill has a matching Codex prompt', () => {
    const skills = listSkills();
    const prompts = new Set(listCodexPrompts());
    const missing = skills.filter((s) => !prompts.has(s));
    assert.deepEqual(
      missing,
      [],
      `Skills without Codex prompts (run: node bin/sync-codex.mjs): ${missing.join(', ')}`,
    );
  });

  test('every Codex prompt has a matching skill', () => {
    const skills = new Set(listSkills());
    const prompts = listCodexPrompts();
    const orphans = prompts.filter((p) => !skills.has(p));
    assert.deepEqual(
      orphans,
      [],
      `Codex prompts without skills (orphans): ${orphans.join(', ')}`,
    );
  });

  test('every agent has a synced .codex/agents/*.toml counterpart', () => {
    const sources = readdirSync(join(ROOT, 'agents')).filter((f) => f.endsWith('.md'));
    const destDir = join(ROOT, '.codex/agents');
    const missing = sources.filter(
      (f) => !existsSync(join(destDir, f.replace(/\.md$/, '.toml'))),
    );
    assert.deepEqual(
      missing,
      [],
      `Agents not synced to Codex (run: node bin/sync-codex.mjs): ${missing.join(', ')}`,
    );
  });

  test('no orphan .toml files in .codex/agents/', () => {
    const sources = new Set(
      readdirSync(join(ROOT, 'agents'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, '.toml')),
    );
    const orphans = readdirSync(join(ROOT, '.codex/agents'))
      .filter((f) => f.endsWith('.toml'))
      .filter((f) => !sources.has(f));
    assert.deepEqual(
      orphans,
      [],
      `Orphan .codex/agents/ files (no source in agents/): ${orphans.join(', ')}`,
    );
  });
});
