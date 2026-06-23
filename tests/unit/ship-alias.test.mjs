// tests/unit/ship-alias.test.mjs
//
// Run: `node --test tests/unit/ship-alias.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('create-pr deprecated alias', () => {
  test('alias skill exists, names ship as the replacement, executes ship.md', () => {
    const s = read('skills/create-pr/SKILL.md');
    assert.match(s, /deprecated/i);
    assert.match(s, /\/jlu-ship/);
    assert.match(s, /jelou\/workflows\/ship\.md/);
  });
  test('alias workflow is executable: contains deprecation marker and active delegation to ship.md', () => {
    const w = read('jelou/workflows/create-pr.md');
    assert.match(w, /⚠️.*jlu-create-pr.*deprecated/i, 'must contain deprecation notice');
    assert.match(w, /(execute|run|read and execute|follow)[^\n]*ship\.md/i, 'must contain an executable delegation to ship.md');
  });
  test('all 3 layers exist for both ship and create-pr (parity inputs)', () => {
    for (const p of [
      'skills/ship/SKILL.md', 'jelou/workflows/ship.md', '.opencode/commands/jlu-ship.md',
      'skills/create-pr/SKILL.md', 'jelou/workflows/create-pr.md', '.opencode/commands/jlu-create-pr.md',
    ]) assert.ok(existsSync(join(ROOT, p)), `missing ${p}`);
  });
});
