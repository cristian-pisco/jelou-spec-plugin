// tests/unit/dual-branch-eager-creation.test.mjs
//
// Cross-document consistency guard for eager dual-branch creation.
//
// Regression guard for: the dual-PR workflow used to synthesize staging/<slug>
// lazily at /jlu-create-pr. It now creates BOTH branches at /jlu-new-task time
// (production/<slug> from trunk, staging/<slug> from origin/alpha + pushed) and
// /jlu-create-pr reuses the pre-created staging branch (rebuilding only when
// origin/alpha moved). These assertions pin the agreement across the reference,
// the agent definition, and every workflow that documents the behavior — so a
// future edit to one document cannot silently re-introduce the old "synthesized
// on-demand, never created at task creation" model in another.
//
// Run: `node --test tests/unit/dual-branch-eager-creation.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('git-conventions: staging created at new-task', () => {
  const gc = read('jelou/references/git-conventions.md');

  test('does not describe staging as synthesized-only / not-created-at-task', () => {
    assert.doesNotMatch(gc, /Synthesized on-demand/);
    assert.doesNotMatch(gc, /\*\*Not\*\* created at task creation/);
  });

  test('states staging is created at /jlu-new-task and pushed', () => {
    assert.match(gc, /\*\*Created at task creation\*\*/);
    assert.match(gc, /pushed to the remote/);
  });

  test('reuse-vs-rebuild contract is documented', () => {
    assert.match(gc, /reuses\*\* the pre-created branch/);
    assert.match(gc, /rebuilds\*\* it from fresh `origin\/alpha`/);
  });

  test('git-agent does exactly the initial staging push; later pushes are orchestrator-owned', () => {
    assert.match(gc, /initial create-from-`origin\/alpha` \+ non-force push/);
    assert.match(gc, /`staging\/<slug>` creation \+ initial push \| `\/jlu-new-task` Step 15c/);
  });
});
