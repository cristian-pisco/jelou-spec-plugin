import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMANDS = join(ROOT, '.opencode/commands');

const PLACEHOLDERS = new Set(['jlu-daily-slack.md', 'jlu-task-clickup.md']);

function commandFiles() {
  return readdirSync(COMMANDS)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

function resolvingCommands() {
  return commandFiles().filter((f) => !PLACEHOLDERS.has(f));
}

const read = (f) => readFileSync(join(COMMANDS, f), 'utf8');

describe('opencode commands — the install root is derived, never hardcoded', () => {
  test('no command hardcodes a literal install path', () => {
    const offenders = [];
    for (const f of commandFiles()) {
      for (const line of read(f).split('\n')) {
        if (/`[^`]*\.config\/opencode/.test(line) || /`~\/|`\$HOME\//.test(line)) {
          offenders.push(`${f}: ${line.trim()}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'setup honours $OPENCODE_HOME, so a literal ~/.config/opencode misses the install entirely. ' +
        'Derive <install-root> by walking up to the nearest ancestor holding a jelou/ directory.',
    );
  });

  test('every resolving command states the walk-up rule', () => {
    for (const f of resolvingCommands()) {
      const src = read(f);
      assert.match(src, /walk up from THIS command file/, `${f} must state how to derive <install-root>`);
      assert.match(src, /\$OPENCODE_HOME/, `${f} must warn that $OPENCODE_HOME moves the root`);
    }
  });

  test('every resolving command offers an install candidate and a project-local one', () => {
    for (const f of resolvingCommands()) {
      const src = read(f);
      assert.match(src, /<install-root>\/jelou\/workflows/, `${f} lacks an install-rooted candidate`);
      assert.match(src, /^\d\. `jelou\/workflows/m, `${f} lacks a project-local candidate`);
    }
  });

  test('the declared placeholders really do not resolve a workflow', () => {
    for (const f of PLACEHOLDERS) {
      const src = read(f);
      assert.doesNotMatch(src, /jelou\/workflows/, `${f} resolves a workflow — drop it from PLACEHOLDERS`);
      assert.match(src, /Phase 2/, `${f} is listed as a placeholder but does not say so`);
    }
  });

  test('every command names a workflow that exists', () => {
    const workflows = new Set(readdirSync(join(ROOT, 'jelou/workflows')));
    const openCodeWorkflows = new Set(readdirSync(join(ROOT, 'jelou/workflows-opencode')));
    for (const f of resolvingCommands()) {
      for (const m of read(f).matchAll(/jelou\/(workflows|workflows-opencode)\/([a-z0-9-]+\.md)/g)) {
        const pool = m[1] === 'workflows' ? workflows : openCodeWorkflows;
        assert.ok(pool.has(m[2]), `${f} points at jelou/${m[1]}/${m[2]}, which does not exist`);
      }
    }
  });
});
