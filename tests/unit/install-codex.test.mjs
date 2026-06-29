import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'bin/install-codex.sh');

function runInstall(args = [], env = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, ...env },
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
