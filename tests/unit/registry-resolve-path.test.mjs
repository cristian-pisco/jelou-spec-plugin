// tests/unit/registry-resolve-path.test.mjs
//
// Run: `node --test tests/unit/registry-resolve-path.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveServicePath } from '../../bin/lib/registry/resolve-path.mjs';

describe('resolveServicePath', () => {
  test('resolves a relative path against the workspace root', () => {
    assert.equal(
      resolveServicePath({ workspaceRoot: '/home/u/jelou-projects/ws', relativePath: '../jelou-api' }),
      '/home/u/jelou-projects/jelou-api'
    );
  });

  test('an absolute path is returned as-is', () => {
    assert.equal(resolveServicePath({ workspaceRoot: '/ws', relativePath: '/abs/jelou-api' }), '/abs/jelou-api');
  });

  test('a missing relativePath throws a typed error naming the field', () => {
    assert.throws(() => resolveServicePath({ workspaceRoot: '/ws', relativePath: '' }), /relativePath/);
  });
});
