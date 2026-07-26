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
    assert.match(src, /use the jlu-load-context skill/);
    assert.match(src, /not as a shell executable or a `skills\/\*\/SKILL\.md` skill/);
    assert.match(src, /\.codex\/prompts\/<command>\.md/);
    assert.match(src, /\$CODEX_HOME\/prompts\/<command>\.md/);
    assert.match(src, /Match command names exactly/);
    assert.match(src, /Never fuzzy-correct/);
    assert.match(src, /Never search `PATH`/);
    assert.match(src, /`skills\/\*\/SKILL\.md`/);
  });

  test('the Codex runtime reference carries the same fallback', () => {
    const src = readRepo('jelou/references/codex-runtime.md');
    assert.match(src, /## Invocation model/);
    assert.match(src, /bare `jlu-\*` command token/);
    assert.match(src, /not as a shell command or a `skills\/\*\/SKILL\.md` skill/);
    assert.match(src, /use the jlu-load-context skill/);
    assert.match(src, /Command matching is exact/);
    assert.match(src, /Never fuzzy-correct/);
    assert.match(src, /Never search\s+`PATH`/);
    assert.match(src, /Missing `AskUserQuestion` is not a blocker in Codex/);
    assert.match(src, /Do not continue inline/);
  });

  test('README points PATH lookup symptoms to Codex installation', () => {
    const src = readRepo('README.md');
    assert.match(src, /Use the slash form in Codex/);
    assert.match(src, /not on `PATH`/);
    assert.match(src, /\.\/setup --host codex/);
  });

  test('the Codex installer names load-context and the skill restart guidance', () => {
    const src = readRepo('bin/install-codex.sh');
    assert.match(src, /jlu-load-context/);
    assert.match(src, /Restart Codex so it loads the new skills/);
  });
});
