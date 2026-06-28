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
  test('AGENTS.md maps bare jlu-* input to prompts, not PATH', () => {
    const src = readRepo('AGENTS.md');
    assert.match(src, /Codex command normalization/);
    assert.match(src, /matching Codex prompt/);
    assert.match(src, /\.codex\/prompts\/<command>\.md/);
    assert.match(src, /\$CODEX_HOME\/prompts\/<command>\.md/);
    assert.match(src, /Never search `PATH`/);
  });

  test('the Codex runtime reference carries the same fallback', () => {
    const src = readRepo('jelou/references/codex-runtime.md');
    assert.match(src, /## Invocation model/);
    assert.match(src, /bare `jlu-\*` command token/);
    assert.match(src, /not as a shell command/);
    assert.match(src, /Never search\s+`PATH`/);
  });

  test('README points PATH lookup symptoms to Codex installation', () => {
    const src = readRepo('README.md');
    assert.match(src, /Use the slash form in Codex/);
    assert.match(src, /not on `PATH`/);
    assert.match(src, /\.\/setup --host codex/);
  });

  test('the Codex installer names load-context and the PATH lookup symptom', () => {
    const src = readRepo('bin/install-codex.sh');
    assert.match(src, /\/jlu-load-context/);
    assert.match(src, /PATH lookup/);
  });
});
