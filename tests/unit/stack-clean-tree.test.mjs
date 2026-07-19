// tests/unit/stack-clean-tree.test.mjs
//
// Run: `node --test tests/unit/stack-clean-tree.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { gitStatusPorcelainArgs, isCleanTree } from '../../bin/lib/dev-orchestrator/stack/clean-tree.mjs';

describe('clean-tree', () => {
  test('gitStatusPorcelainArgs is the porcelain form', () => {
    assert.deepEqual(gitStatusPorcelainArgs(), ['status', '--porcelain']);
  });

  test('empty or whitespace-only output is clean', () => {
    assert.equal(isCleanTree(''), true);
    assert.equal(isCleanTree('  \n '), true);
    assert.equal(isCleanTree(undefined), true);
  });

  test('any porcelain entry is dirty', () => {
    assert.equal(isCleanTree(' M src/app.ts\n'), false);
    assert.equal(isCleanTree('?? new.txt'), false);
  });
});
