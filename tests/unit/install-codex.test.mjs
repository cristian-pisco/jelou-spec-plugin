import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'bin/install-codex.sh');

function sandboxHome() {
  return mkdtempSync(join(tmpdir(), 'codex-fakehome-'));
}

function runInstall(args = [], env = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, HOME: sandboxHome(), ...env },
  });
}

describe('install-codex — TUI context status line', () => {
  test('writes context remaining on a fresh global install', () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'));

    const result = runInstall([], { CODEX_HOME: codexHome });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const config = readFileSync(join(codexHome, 'config.toml'), 'utf8');
    assert.match(config, /^\[tui\]$/m);
    assert.match(config, /status_line = \["model-with-reasoning", "context-remaining", "current-dir"\]/);
  });

  test('adds context remaining to an existing global status line', () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'));
    writeFileSync(join(codexHome, 'config.toml'), '[tui]\nstatus_line = ["model", "git-branch"]\n');

    const result = runInstall([], { CODEX_HOME: codexHome });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const config = readFileSync(join(codexHome, 'config.toml'), 'utf8');
    assert.match(config, /status_line = \["model", "context-remaining", "git-branch"\]/);
    assert.equal((config.match(/^\[tui\]$/gm) || []).length, 1);
  });

  test('inserts status line into an existing global tui table', () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'));
    writeFileSync(join(codexHome, 'config.toml'), '[tui]\nnotifications = false\n');

    const result = runInstall([], { CODEX_HOME: codexHome });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const config = readFileSync(join(codexHome, 'config.toml'), 'utf8');
    assert.match(config, /status_line = \["model-with-reasoning", "context-remaining", "current-dir"\]/);
    assert.match(config, /notifications = false/);
    assert.equal((config.match(/^\[tui\]$/gm) || []).length, 1);
  });

  test('project installs include context remaining in .codex config', () => {
    const project = mkdtempSync(join(tmpdir(), 'codex-project-'));

    const result = runInstall([project]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const config = readFileSync(join(project, '.codex/config.toml'), 'utf8');
    assert.match(config, /^\[tui\]$/m);
    assert.match(config, /status_line = \["model-with-reasoning", "context-remaining", "current-dir"\]/);
  });
});

describe('install-codex — native skill install', () => {
  test('global install writes skills under $HOME/.agents/skills, never $CODEX_HOME', () => {
    const home = sandboxHome();
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'));

    const result = runInstall([], { HOME: home, CODEX_HOME: codexHome });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    assert.ok(existsSync(join(home, '.agents/skills/jlu-new-task/SKILL.md')));
    assert.ok(existsSync(join(codexHome, 'agents/jlu-implementer.toml')));
    assert.ok(!existsSync(join(codexHome, 'skills')));
    assert.match(result.stdout, /Installed Codex skills/);
  });

  test('global install leaves no prompts directory behind', () => {
    const home = sandboxHome();
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'));

    runInstall([], { HOME: home, CODEX_HOME: codexHome });

    assert.ok(!existsSync(join(codexHome, 'prompts')));
  });

  test('upgrade removes stale jlu prompts from a prior install', () => {
    const home = sandboxHome();
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'));
    mkdirSync(join(codexHome, 'prompts'), { recursive: true });
    writeFileSync(join(codexHome, 'prompts/jlu-new-task.md'), 'stale prompt\n');

    const result = runInstall([], { HOME: home, CODEX_HOME: codexHome });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    assert.ok(!existsSync(join(codexHome, 'prompts/jlu-new-task.md')));
    assert.ok(!existsSync(join(codexHome, 'prompts')));
  });

  test('upgrade keeps non-jlu prompts and their directory', () => {
    const home = sandboxHome();
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'));
    mkdirSync(join(codexHome, 'prompts'), { recursive: true });
    writeFileSync(join(codexHome, 'prompts/jlu-new-task.md'), 'stale prompt\n');
    writeFileSync(join(codexHome, 'prompts/my-own.md'), 'user prompt\n');

    runInstall([], { HOME: home, CODEX_HOME: codexHome });

    assert.ok(!existsSync(join(codexHome, 'prompts/jlu-new-task.md')));
    assert.equal(readFileSync(join(codexHome, 'prompts/my-own.md'), 'utf8'), 'user prompt\n');
  });

  test('project install writes skills under <project>/.agents/skills', () => {
    const project = mkdtempSync(join(tmpdir(), 'codex-project-'));

    const result = runInstall([project]);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    assert.ok(existsSync(join(project, '.agents/skills/jlu-new-task/SKILL.md')));
    assert.ok(!existsSync(join(project, '.codex/prompts')));
  });

  test('installed skill carries the native frontmatter contract', () => {
    const project = mkdtempSync(join(tmpdir(), 'codex-project-'));
    runInstall([project]);

    const skill = readFileSync(join(project, '.agents/skills/jlu-new-task/SKILL.md'), 'utf8');
    assert.match(skill, /^---\nname: jlu-new-task\n/);
    assert.match(skill, /description: ".*Triggers: .*"/);
  });

  test('reinstall purges jlu skills retired upstream', () => {
    const home = sandboxHome();
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'));
    mkdirSync(join(home, '.agents/skills/jlu-retired'), { recursive: true });
    writeFileSync(join(home, '.agents/skills/jlu-retired/SKILL.md'), '---\nname: jlu-retired\n---\nx\n');

    const result = runInstall([], { HOME: home, CODEX_HOME: codexHome });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    assert.ok(!existsSync(join(home, '.agents/skills/jlu-retired')));
    assert.ok(existsSync(join(home, '.agents/skills/jlu-new-task/SKILL.md')));
  });

  test('reinstall leaves skills the plugin does not own alone', () => {
    const home = sandboxHome();
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'));
    mkdirSync(join(home, '.agents/skills/my-own-skill'), { recursive: true });
    writeFileSync(join(home, '.agents/skills/my-own-skill/SKILL.md'), 'mine\n');

    runInstall([], { HOME: home, CODEX_HOME: codexHome });

    assert.equal(readFileSync(join(home, '.agents/skills/my-own-skill/SKILL.md'), 'utf8'), 'mine\n');
  });

  test('CODEX_SKILLS_DIR redirects the global skill destination', () => {
    const home = sandboxHome();
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-home-'));
    const skillsDir = join(mkdtempSync(join(tmpdir(), 'codex-skills-')), 'nested');

    const result = runInstall([], { HOME: home, CODEX_HOME: codexHome, CODEX_SKILLS_DIR: skillsDir });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    assert.ok(existsSync(join(skillsDir, 'jlu-new-task/SKILL.md')));
    assert.ok(!existsSync(join(home, '.agents/skills')));
  });

  test('aborts when the generated skill mirror is missing', () => {
    const fakePlugin = mkdtempSync(join(tmpdir(), 'codex-noskills-'));
    mkdirSync(join(fakePlugin, 'bin'), { recursive: true });
    mkdirSync(join(fakePlugin, '.codex/agents'), { recursive: true });
    cpSync(SCRIPT, join(fakePlugin, 'bin/install-codex.sh'));

    const result = spawnSync('bash', [join(fakePlugin, 'bin/install-codex.sh'), fakePlugin], {
      encoding: 'utf8',
      env: { ...process.env, HOME: sandboxHome() },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /\.codex\/skills not found/);
  });
});
