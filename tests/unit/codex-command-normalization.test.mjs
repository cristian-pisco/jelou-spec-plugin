import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readRepo(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('Codex jlu command normalization', () => {
  test('the Codex runtime reference carries the fallback', () => {
    const src = readRepo('jelou/references/codex-runtime.md');
    assert.match(src, /## Invocation model/);
    assert.match(src, /Invoke explicitly with `\$jlu-<skill>`/);
    assert.match(src, /bare `jlu-\*` command token/);
    assert.match(src, /not as a shell command\s+or a `skills\/\*\/SKILL\.md` skill entry point/);
    assert.match(src, /use the jlu-load-context skill/);
    assert.match(src, /Resolve `\.agents\/skills\/jlu-<name>\/SKILL\.md`/);
    assert.match(src, /Command matching is exact/);
    assert.match(src, /never fuzzy-correct/);
    assert.match(src, /Never search `PATH`/);
    assert.match(src, /Missing `AskUserQuestion` is not a blocker in Codex/);
    assert.match(src, /Do not continue inline/);
  });

  test('README points PATH lookup symptoms to Codex installation', () => {
    const src = readRepo('README.md');
    assert.match(src, /Use the explicit skill form in Codex \(`\$jlu-load-context`\)/);
    assert.match(src, /treats it as the matching\s+skill/);
    assert.match(src, /not on `PATH`/);
    assert.match(src, /\.\/setup --host codex/);
  });

  test('the Codex installer names load-context and the skill restart guidance', () => {
    const src = readRepo('bin/install-codex.sh');
    assert.match(src, /jlu-load-context/);
    assert.match(src, /Restart Codex so it loads the new skills/);
  });
});
