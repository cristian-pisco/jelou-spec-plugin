// tests/unit/test-suite-worktree-scope.test.mjs
//
// Run: `node --test tests/unit/test-suite-worktree-scope.test.mjs`
// Node 20+ required.
//
// /jlu-test-suite runs the project's FULL jest/vitest suite. When the repo
// contains /jlu-new-task worktrees at <repo>/.worktrees/<slug>/, the runner
// discovers their stale specs (git-ignore does not stop test discovery) and
// runs cross-task specs, inflating counts and adding foreign failures. The
// workflow must inject a worktree exclusion. This file pins that instruction
// so it cannot silently regress.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relPath) => readFileSync(join(ROOT, relPath), 'utf8');

describe('test-suite workflow — excludes sibling worktrees from discovery', () => {
  const wf = read('jelou/workflows/test-suite.md');

  test('has a dedicated step for worktree exclusion', () => {
    assert.match(wf, /worktree/i);
    assert.match(wf, /\.worktrees/);
  });

  test('injects a jest testPathIgnorePatterns exclusion for .worktrees', () => {
    assert.match(wf, /testPathIgnorePatterns/);
    assert.match(wf, /\\\.worktrees/);
  });

  test('warns that the CLI flag replaces (does not merge) config patterns', () => {
    assert.match(wf, /replace/i);
    assert.match(wf, /node_modules/);
  });

  test('covers vitest via --exclude as well as jest', () => {
    assert.match(wf, /--exclude/);
    assert.match(wf, /\*\*\/\.worktrees\/\*\*/);
  });

  test('gates the exclusion on EFFECTIVE_PATH actually containing .worktrees/', () => {
    assert.match(wf, /EFFECTIVE_PATH/);
  });
});
