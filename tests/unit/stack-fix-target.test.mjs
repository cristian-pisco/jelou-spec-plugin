// tests/unit/stack-fix-target.test.mjs
//
// Run: `node --test tests/unit/stack-fix-target.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveFixTarget } from '../../bin/lib/dev-orchestrator/stack/fix-target.mjs';

describe('resolveFixTarget', () => {
  test('a worktree service edits its worktree, no guard', () => {
    const out = resolveFixTarget({ service: 'svc-b', worktreePaths: { 'svc-b': '/repo/b/.worktrees/t' }, repoPath: '/repo/b' });
    assert.deepEqual(out, { path: '/repo/b/.worktrees/t', isWorktree: true, needsCleanGuard: false });
  });

  test('a main-branch service edits the repo and needs the clean-tree guard', () => {
    const out = resolveFixTarget({ service: 'svc-a', worktreePaths: {}, repoPath: '/repo/a' });
    assert.deepEqual(out, { path: '/repo/a', isWorktree: false, needsCleanGuard: true });
  });
});
