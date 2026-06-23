// tests/unit/deps-validator-agent.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'agents', 'jlu-deps-validator.md');

describe('jlu-deps-validator agent', () => {
  test('exists with correct frontmatter name', () => {
    assert.ok(existsSync(SRC));
    const body = readFileSync(SRC, 'utf8');
    assert.match(body, /^name:\s*jlu-deps-validator$/m);
  });
  test('report-only: no Write tool, uses install-dep --validate', () => {
    const body = readFileSync(SRC, 'utf8');
    assert.match(body, /tools:\s*Read, Bash, Glob, Grep\s*$/m);
    assert.match(body, /install-dep\.mjs --validate/);
  });
  test('reads subagent-base.md', () => {
    assert.match(readFileSync(SRC, 'utf8'), /subagent-base\.md/);
  });
  test('opencode + codex mirrors are in sync', () => {
    assert.ok(existsSync(join(ROOT, '.opencode/agents/jlu-deps-validator.md')));
    assert.ok(existsSync(join(ROOT, '.codex/agents/jlu-deps-validator.toml')));
  });
});
