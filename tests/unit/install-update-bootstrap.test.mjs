import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UPDATER = join(ROOT, 'bin/jlu-update.sh');
const PHASE_HELPERS = ['classify-phase.sh', 'finalize-phase.sh', 'format-changed-files.sh'];

function assertUpdaterInstalled(path) {
  assert.equal(readFileSync(path, 'utf8'), readFileSync(UPDATER, 'utf8'));
  assert.notEqual(statSync(path).mode & 0o111, 0);
}

function assertUpdaterBootstraps(path, host) {
  const cacheRoot = mkdtempSync(join(tmpdir(), `${host}-update-cache-`));
  const cache = join(cacheRoot, 'cache');
  const result = spawnSync('bash', [path, '--host', host], {
    encoding: 'utf8',
    env: { ...process.env, JLU_HOME: cache, JLU_UPDATE_DRYRUN: '1' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`^HOST: ${host}$`, 'm'));
  assert.match(result.stdout, /^PLAN: clone .* -> /m);
  assert.match(result.stdout, new RegExp(`^PLAN: setup --host ${host}$`, 'm'));
}

function assertPhaseHelpersInstalled(binDir) {
  for (const helper of PHASE_HELPERS) {
    const path = join(binDir, helper);
    assert.notEqual(statSync(path).mode & 0o111, 0, `${helper} is not executable`);
  }
}

describe('runtime installers — update bootstrap', () => {
  test('Codex installs an executable updater beside global workflows', () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'codex-update-bootstrap-'));
    const result = spawnSync('bash', [join(ROOT, 'bin/install-codex.sh')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, CODEX_HOME: codexHome },
    });

    assert.equal(result.status, 0, result.stderr);
    const installedUpdater = join(codexHome, 'jelou/bin/jlu-update.sh');
    assertUpdaterInstalled(installedUpdater);
    assertUpdaterBootstraps(installedUpdater, 'codex');
    assertPhaseHelpersInstalled(join(codexHome, 'bin'));
  });

  test('OpenCode installs an executable updater beside global workflows', () => {
    const openCodeHome = mkdtempSync(join(tmpdir(), 'opencode-update-bootstrap-'));
    writeFileSync(join(openCodeHome, 'opencode.json'), '{}\n');
    const result = spawnSync('bash', [join(ROOT, 'bin/install-opencode.sh'), openCodeHome], {
      cwd: ROOT,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const installedUpdater = join(openCodeHome, 'jelou/bin/jlu-update.sh');
    assertUpdaterInstalled(installedUpdater);
    assertUpdaterBootstraps(installedUpdater, 'opencode');
    assertPhaseHelpersInstalled(join(openCodeHome, 'bin'));
  });
});
