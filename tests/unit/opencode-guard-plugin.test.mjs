// tests/unit/opencode-guard-plugin.test.mjs
//
// The OpenCode guard plugin (.opencode/plugins/guard.ts) reuses the pure
// classifiers from the Claude Code guards. This locks that contract: the
// classifiers must stay exported, and the plugin must keep wiring them to the
// right tool names. The classifier LOGIC itself is covered by
// guard-env-reads.test.mjs and guard-test-commands.test.mjs.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCommand, defaultResolveScript } from '../../bin/guard-test-commands.mjs';
import { classifyBashCommand, classifyRead } from '../../bin/guard-env-reads.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = join(ROOT, '.opencode/plugins/guard.ts');

describe('opencode guard plugin — classifier contract', () => {
  test('the classifiers the plugin imports are exported functions', () => {
    assert.equal(typeof classifyCommand, 'function');
    assert.equal(typeof defaultResolveScript, 'function');
    assert.equal(typeof classifyBashCommand, 'function');
    assert.equal(typeof classifyRead, 'function');
  });

  test('classifiers still deny the canonical hazards (sanity, end-to-end)', () => {
    assert.equal(classifyRead('.env').decision, 'deny');
    assert.equal(classifyRead('config.ts').decision, 'allow');
    assert.equal(classifyCommand('npm test', { cwd: ROOT, resolveScript: () => null }).decision, 'deny');
    assert.equal(classifyBashCommand('cat .env', ROOT).decision, 'deny');
  });
});

describe('opencode guard plugin — wiring', () => {
  test('plugin file exists', () => {
    assert.equal(existsSync(PLUGIN), true, `missing ${PLUGIN}`);
  });

  test('imports the classifiers from the bin guards', () => {
    const src = readFileSync(PLUGIN, 'utf8');
    assert.match(src, /classifyCommand[\s\S]*from "\.\.\/\.\.\/bin\/guard-test-commands\.mjs"/);
    assert.match(src, /classifyBashCommand[\s\S]*classifyRead[\s\S]*from "\.\.\/\.\.\/bin\/guard-env-reads\.mjs"/);
  });

  test('intercepts via tool.execute.before, handles bash + shell + read, blocks by throwing', () => {
    const src = readFileSync(PLUGIN, 'utf8');
    assert.match(src, /"tool\.execute\.before"/);
    assert.match(src, /=== "bash" \|\| input\.tool === "shell"/);
    assert.match(src, /input\.tool === "read"/);
    assert.match(src, /throw new Error\(/);
  });
});
