import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { userSettingsPath, seedSettings, resolveSetting } from '../../bin/jlu-settings.mjs';

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'jlu-settings-'));
}

describe('jlu-settings', () => {
  test('seed creates ~/.jlu/settings.json from the template once', () => {
    const home = tempHome();
    const first = seedSettings(home);
    assert.equal(first.created, true);
    assert.equal(first.path, userSettingsPath(home));
    const seeded = JSON.parse(readFileSync(first.path, 'utf8'));
    assert.equal(seeded.autochain, false);
    const second = seedSettings(home);
    assert.equal(second.created, false);
  });

  test('seed never clobbers an existing user file', () => {
    const home = tempHome();
    mkdirSync(join(home, '.jlu'), { recursive: true });
    writeFileSync(userSettingsPath(home), JSON.stringify({ autochain: true }));
    const result = seedSettings(home);
    assert.equal(result.created, false);
    assert.equal(JSON.parse(readFileSync(userSettingsPath(home), 'utf8')).autochain, true);
  });

  test('resolveSetting reads the user file and seeds when absent', () => {
    const home = tempHome();
    assert.equal(resolveSetting('autochain', { home, environ: {} }), false);
    assert.ok(existsSync(userSettingsPath(home)));
    writeFileSync(userSettingsPath(home), JSON.stringify({ autochain: true }));
    assert.equal(resolveSetting('autochain', { home, environ: {} }), true);
  });

  test('env override wins and parses booleans', () => {
    const home = tempHome();
    assert.equal(resolveSetting('autochain', { home, environ: { JLU_AUTOCHAIN: 'true' } }), true);
    assert.equal(resolveSetting('autochain', { home, environ: { JLU_AUTOCHAIN: '0' } }), false);
  });

  test('corrupt user file falls back to the template default', () => {
    const home = tempHome();
    mkdirSync(join(home, '.jlu'), { recursive: true });
    writeFileSync(userSettingsPath(home), 'not-json{');
    assert.equal(resolveSetting('autochain', { home, environ: {} }), false);
  });

  test('unknown key resolves to undefined without throwing', () => {
    const home = tempHome();
    assert.equal(resolveSetting('nonexistent_key', { home, environ: {} }), undefined);
  });
});
