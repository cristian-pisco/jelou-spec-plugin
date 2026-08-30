import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SETUP = readFileSync(join(ROOT, 'setup'), 'utf8');
const INSTALLER = join(ROOT, 'bin/install.sh');

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'jlu-claude-home-'));
  return { home, claudeDir: join(home, '.claude') };
}

function runInstaller({ claudeDir, home }) {
  return spawnSync('bash', [INSTALLER], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, HOME: home, CLAUDE_HOME: claudeDir, JLU_SKIP_SYNC_AGENTS: 'true' },
  });
}

function seedSkill(claudeDir, name, body) {
  mkdirSync(join(claudeDir, 'skills', name), { recursive: true });
  writeFileSync(join(claudeDir, 'skills', name, 'SKILL.md'), body);
}

const pluginInstalledSkill = (name) => `---\nname: ${name}\ndescription: d\n---\n\nRead <plugin-root>/jelou/workflows/${name}.md\n`;
const foreignSkill = (name) => `---\nname: ${name}\ndescription: from another source\n---\n\nunrelated body\n`;

describe('setup — the plugin system owns the Claude Code install', () => {
  test('the copy path is reachable only behind --legacy-copy', () => {
    const invocations = SETUP.split('\n').filter((line) => line.includes('bin/install.sh') && !line.trim().startsWith('#'));
    assert.equal(invocations.length, 1, 'exactly one place may invoke the legacy installer');
    const guard = SETUP.slice(0, SETUP.indexOf(invocations[0]));
    assert.match(guard.slice(-200), /if \[ "\$LEGACY_COPY" = "true" \]; then/);
  });

  test('--legacy-copy is a declared flag, not an undocumented escape hatch', () => {
    assert.match(SETUP, /--legacy-copy\)\n\s+LEGACY_COPY="true"/);
    assert.match(SETUP, /--legacy-copy\s+Claude Code only/);
  });

  test('the default Claude path reports plugin state instead of copying', () => {
    assert.match(SETUP, /report_claude_plugin_state/);
    assert.match(SETUP, /claude plugin install jlu@jelou-spec-plugin/);
    assert.match(SETUP, /--plugin-dir/);
  });
});

describe('legacy installer — every run leaves only what this version ships', () => {
  test('a skill the plugin retired does not survive the next install', () => {
    const box = sandbox();
    seedSkill(box.claudeDir, 'rollback-phase', pluginInstalledSkill('rollback-phase'));
    const result = runInstaller(box);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(box.claudeDir, 'skills', 'rollback-phase')), false);
    assert.match(result.stdout, /Purged 1 previously installed skill/);
  });

  test('an agent the plugin retired does not survive either', () => {
    const box = sandbox();
    mkdirSync(join(box.claudeDir, 'agents'), { recursive: true });
    writeFileSync(join(box.claudeDir, 'agents', 'jlu-legacy-runner.md'), 'stale\n');
    writeFileSync(join(box.claudeDir, 'agents', 'unrelated-agent.md'), 'not ours\n');
    const result = runInstaller(box);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(box.claudeDir, 'agents', 'jlu-legacy-runner.md')), false);
    assert.ok(existsSync(join(box.claudeDir, 'agents', 'unrelated-agent.md')), 'agents outside the jlu- namespace are not ours to delete');
  });

  test('a same-named skill from another source is never overwritten', () => {
    const box = sandbox();
    seedSkill(box.claudeDir, 'ship', foreignSkill('ship'));
    const result = runInstaller(box);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(box.claudeDir, 'skills', 'ship', 'SKILL.md'), 'utf8'), foreignSkill('ship'));
    assert.match(result.stdout, /Skipped ship/);
  });

  test('a fresh install lands every shipped skill and agent', () => {
    const box = sandbox();
    const result = runInstaller(box);
    assert.equal(result.status, 0, result.stderr);
    const shipped = readdirSync(join(ROOT, 'skills'));
    const installed = readdirSync(join(box.claudeDir, 'skills'));
    assert.deepEqual(installed.sort(), shipped.sort());
    assert.deepEqual(
      readdirSync(join(box.claudeDir, 'agents')).sort(),
      readdirSync(join(ROOT, 'agents')).sort(),
    );
  });

  test('running twice is idempotent — no accumulation', () => {
    const box = sandbox();
    runInstaller(box);
    const first = readdirSync(join(box.claudeDir, 'skills')).sort();
    const second = runInstaller(box);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(readdirSync(join(box.claudeDir, 'skills')).sort(), first);
    assert.match(second.stdout, /skipped 0/);
  });

  test('the legacy layout still resolves its own plugin root', () => {
    const box = sandbox();
    runInstaller(box);
    assert.ok(existsSync(join(box.claudeDir, 'jelou', 'workflows')), 'skills resolve <plugin-root>/jelou by walking up two levels');
    assert.ok(existsSync(join(box.claudeDir, 'bin', 'check-update.sh')), 'the same walk reaches <plugin-root>/bin/check-update.sh');
  });
});
