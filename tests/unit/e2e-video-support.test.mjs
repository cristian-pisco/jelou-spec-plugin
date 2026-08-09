// tests/unit/e2e-video-support.test.mjs
//
// Run: `node --test tests/unit/e2e-video-support.test.mjs`
// Node 20+ required.
//
// Guards the E2E video-recording contract: the seed script (idempotent, never
// clobbers a user edit), the ~/.jlu/e2e-settings.json defaults, the SessionStart
// auto-create hook, and the JLU_E2E_VIDEO wiring across ui-qa-run, cleanup, the
// writer/runner agents, the update flow, and playwright-conventions.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SCRIPT = join(ROOT, 'bin', 'seed-e2e-settings.mjs');
const mod = await import(new URL('../../bin/seed-e2e-settings.mjs', import.meta.url));

const freshHome = () => mkdtempSync(join(tmpdir(), 'jlu-e2e-video-'));

describe('e2e-settings template', () => {
  const cfg = JSON.parse(read('jelou/config/e2e-settings.json'));

  test('ships with video mode "on" (records every run)', () => {
    assert.equal(cfg.video.mode, 'on');
  });

  test('declares a retention window', () => {
    assert.ok(Number.isInteger(cfg.retentionDays) && cfg.retentionDays >= 0);
  });
});

describe('seed-e2e-settings.mjs — seeding', () => {
  test('creates ~/.jlu/e2e-settings.json when absent', () => {
    const home = freshHome();
    const res = mod.seedSettings(home);
    assert.equal(res.created, true);
    assert.ok(existsSync(mod.userSettingsPath(home)));
    assert.equal(JSON.parse(readFileSync(mod.userSettingsPath(home), 'utf8')).video.mode, 'on');
  });

  test('never clobbers a user-edited settings file', () => {
    const home = freshHome();
    const p = mod.userSettingsPath(home);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ video: { mode: 'off' }, retentionDays: 3 }));
    const res = mod.seedSettings(home);
    assert.equal(res.created, false);
    assert.equal(JSON.parse(readFileSync(p, 'utf8')).video.mode, 'off');
  });
});

describe('seed-e2e-settings.mjs — mode resolution', () => {
  test('a pre-set env var wins over the file', () => {
    assert.equal(mod.resolveVideoMode(freshHome(), { JLU_E2E_VIDEO: 'off' }), 'off');
  });

  test('falls back to the settings file (default on) when env is unset', () => {
    assert.equal(mod.resolveVideoMode(freshHome(), {}), 'on');
  });

  test('honors a user-edited mode', () => {
    const home = freshHome();
    const p = mod.userSettingsPath(home);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ video: { mode: 'retain-on-failure' } }));
    assert.equal(mod.resolveVideoMode(home, {}), 'retain-on-failure');
  });

  test('resolves a numeric retention window', () => {
    assert.ok(Number.isInteger(mod.resolveRetentionDays(freshHome())));
  });
});

describe('seed-e2e-settings.mjs — CLI', () => {
  test('--print-video prints a valid mode and seeds the file', () => {
    const home = freshHome();
    const r = spawnSync(process.execPath, [SCRIPT, '--print-video'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, JLU_E2E_VIDEO: '' },
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^(on|retain-on-failure|on-first-retry|off)$/);
    assert.ok(existsSync(mod.userSettingsPath(home)));
  });

  test('bare invocation seeds silently and exits 0', () => {
    const home = freshHome();
    const r = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), '');
    assert.ok(existsSync(mod.userSettingsPath(home)));
  });

  test('--print-retention prints an integer', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--print-retention'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: freshHome() },
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout.trim(), /^\d+$/);
  });
});

const SEEDS_SETTINGS = /seed-e2e-settings\.mjs/;

const sessionStartCommands = (hooksRelPath) => {
  const hooks = JSON.parse(read(hooksRelPath));
  const starts = hooks.hooks.SessionStart ?? [];
  return starts.flatMap((g) => (g.hooks ?? []).map((h) => h.command));
};

describe('startup seeding parity across all three runtimes', () => {
  test('Claude Code: hooks/hooks.json wires SessionStart to the seed script', () => {
    assert.ok(
      sessionStartCommands('hooks/hooks.json').some((c) => SEEDS_SETTINGS.test(c)),
      'hooks/hooks.json SessionStart must run seed-e2e-settings.mjs',
    );
  });

  test('Codex: .codex/hooks.json wires SessionStart to the seed script', () => {
    assert.ok(
      sessionStartCommands('.codex/hooks.json').some((c) => SEEDS_SETTINGS.test(c)),
      '.codex/hooks.json SessionStart must run seed-e2e-settings.mjs',
    );
  });

  test('Codex: a global install writes SessionStart into its generated hooks.json', () => {
    const installer = read('bin/install-codex.sh');
    const generated = installer.slice(installer.indexOf('cat > "$HOOKS_FILE"'));
    assert.ok(generated.length > 0, 'install-codex.sh must generate a hooks.json');
    assert.match(generated, /"SessionStart"[\s\S]*seed-e2e-settings\.mjs/);
  });

  test('OpenCode: the guard plugin seeds in its factory body, before returning hooks', () => {
    const plugin = read('.opencode/plugins/guard.ts');
    assert.match(plugin, /import \{ trySeedSettings \} from "\.\.\/\.\.\/bin\/seed-e2e-settings\.mjs"/);
    const call = plugin.indexOf('trySeedSettings()');
    const hooksReturn = plugin.indexOf('return {');
    assert.ok(call > 0, 'guard.ts must call trySeedSettings()');
    assert.ok(
      call < hooksReturn,
      'trySeedSettings() must run at plugin startup, not inside a tool hook',
    );
  });
});

describe('the read path seeds on any runtime, with no hook at all', () => {
  test('trySeedSettings creates the file and reports failure as null, never throws', () => {
    const home = freshHome();
    assert.equal(mod.trySeedSettings(home).created, true);
    assert.ok(existsSync(mod.userSettingsPath(home)));
    assert.equal(mod.trySeedSettings(home).created, false);
  });

  test('resolveVideoMode creates the settings file when it is absent', () => {
    const home = freshHome();
    assert.equal(existsSync(mod.userSettingsPath(home)), false);
    mod.resolveVideoMode(home, {});
    assert.ok(existsSync(mod.userSettingsPath(home)), 'reading the mode must seed the file');
  });

  test('resolveRetentionDays creates the settings file when it is absent', () => {
    const home = freshHome();
    assert.equal(existsSync(mod.userSettingsPath(home)), false);
    mod.resolveRetentionDays(home);
    assert.ok(existsSync(mod.userSettingsPath(home)), 'reading retention must seed the file');
  });

  test('the seeding read never clobbers a user-edited file', () => {
    const home = freshHome();
    const p = mod.userSettingsPath(home);
    mkdirSync(dirname(p), { recursive: true });
    const edited = JSON.stringify({ video: { mode: 'off' }, retentionDays: 3 });
    writeFileSync(p, edited);
    assert.equal(mod.resolveVideoMode(home, {}), 'off');
    assert.equal(mod.resolveRetentionDays(home), 3);
    assert.equal(readFileSync(p, 'utf8'), edited);
  });
});

describe('JLU_E2E_VIDEO wiring across the harness', () => {
  test('the bootstrap scaffold reads process.env.JLU_E2E_VIDEO', () => {
    const agent = read('agents/jlu-ui-e2e-writer.md');
    assert.match(agent, /video:\s*\(process\.env\.JLU_E2E_VIDEO/);
  });

  test('the runner contract carries the video export', () => {
    assert.match(read('agents/jlu-ui-qa-runner.md'), /JLU_E2E_VIDEO/);
  });

  test('the update flow seeds the settings file', () => {
    assert.match(read('jelou/workflows/update.md'), /seed-e2e-settings\.mjs/);
  });

  test('playwright-conventions documents the video contract', () => {
    const conv = read('jelou/references/playwright-conventions.md');
    assert.match(conv, /JLU_E2E_VIDEO/);
    assert.match(conv, /Video is recorded for every run/i);
  });
});
