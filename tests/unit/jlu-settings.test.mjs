import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userSettingsPath, seedSettings, resolveSetting } from '../../bin/jlu-settings.mjs';

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'jlu-settings.mjs');

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'jlu-settings-'));
}

function runCli(args, home) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, JLU_AUTOCHAIN: '' },
  });
}

describe('jlu-settings', () => {
  test('seed creates ~/.jlu/settings.json from the template once', () => {
    const home = tempHome();
    const first = seedSettings(home);
    assert.equal(first.created, true);
    assert.equal(first.path, userSettingsPath(home));
    const seeded = JSON.parse(readFileSync(first.path, 'utf8'));
    assert.equal(seeded.autochain, true);
    const second = seedSettings(home);
    assert.equal(second.created, false);
  });

  test('seed never clobbers an existing user file', () => {
    const home = tempHome();
    mkdirSync(join(home, '.jlu'), { recursive: true });
    writeFileSync(userSettingsPath(home), JSON.stringify({ autochain: false }));
    const result = seedSettings(home);
    assert.equal(result.created, false);
    assert.equal(JSON.parse(readFileSync(userSettingsPath(home), 'utf8')).autochain, false);
  });

  test('resolveSetting reads the user file and seeds when absent', () => {
    const home = tempHome();
    assert.equal(resolveSetting('autochain', { home, environ: {} }), true);
    assert.ok(existsSync(userSettingsPath(home)));
    writeFileSync(userSettingsPath(home), JSON.stringify({ autochain: false }));
    assert.equal(resolveSetting('autochain', { home, environ: {} }), false);
  });

  test('env override wins and parses booleans case-insensitively', () => {
    const home = tempHome();
    assert.equal(resolveSetting('autochain', { home, environ: { JLU_AUTOCHAIN: 'true' } }), true);
    assert.equal(resolveSetting('autochain', { home, environ: { JLU_AUTOCHAIN: '1' } }), true);
    assert.equal(resolveSetting('autochain', { home, environ: { JLU_AUTOCHAIN: 'TRUE' } }), true);
    assert.equal(resolveSetting('autochain', { home, environ: { JLU_AUTOCHAIN: 'false' } }), false);
    assert.equal(resolveSetting('autochain', { home, environ: { JLU_AUTOCHAIN: '0' } }), false);
    assert.equal(resolveSetting('autochain', { home, environ: { JLU_AUTOCHAIN: 'False' } }), false);
  });

  test('empty env value defers to the file and non-boolean strings pass through raw', () => {
    const home = tempHome();
    mkdirSync(join(home, '.jlu'), { recursive: true });
    writeFileSync(userSettingsPath(home), JSON.stringify({ autochain: false }));
    assert.equal(resolveSetting('autochain', { home, environ: { JLU_AUTOCHAIN: '' } }), false);
    assert.equal(resolveSetting('autochain', { home, environ: { JLU_AUTOCHAIN: 'weird' } }), 'weird');
  });

  test('corrupt user file falls back to the template default', () => {
    const home = tempHome();
    mkdirSync(join(home, '.jlu'), { recursive: true });
    writeFileSync(userSettingsPath(home), 'not-json{');
    assert.equal(resolveSetting('autochain', { home, environ: {} }), true);
  });

  test('unwritable home fails open to the template default', () => {
    const home = tempHome();
    chmodSync(home, 0o555);
    try {
      assert.equal(resolveSetting('autochain', { home, environ: {} }), true);
    } finally {
      chmodSync(home, 0o755);
    }
  });

  test('unknown key resolves to undefined without throwing', () => {
    const home = tempHome();
    assert.equal(resolveSetting('nonexistent_key', { home, environ: {} }), undefined);
  });
});

describe('jlu-settings CLI contract', () => {
  test('get autochain prints true with exit 0 out of the box', () => {
    const home = tempHome();
    const r = runCli(['get', 'autochain'], home);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'true\n');
  });

  test('get reflects the user file opt-out', () => {
    const home = tempHome();
    mkdirSync(join(home, '.jlu'), { recursive: true });
    writeFileSync(join(home, '.jlu', 'settings.json'), JSON.stringify({ autochain: false }));
    const r = runCli(['get', 'autochain'], home);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'false\n');
  });

  test('unknown key prints null with nonzero exit', () => {
    const home = tempHome();
    const r = runCli(['get', 'nonexistent_key'], home);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, 'null\n');
  });

  test('missing or invalid args print usage with exit 2', () => {
    const home = tempHome();
    for (const args of [[], ['get'], ['set', 'autochain']]) {
      const r = runCli(args, home);
      assert.equal(r.status, 2, JSON.stringify(args));
      assert.match(r.stdout, /usage: jlu-settings\.mjs get <key>/);
    }
  });
});
