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

describe('jlu-git-agent: bounded staging initialization', () => {
  const src = read('agents/jlu-git-agent.md');
  const mirror = read('.opencode/agents/jlu-git-agent.md');

  test('drops the absolute "NEVER touches staging" prohibition', () => {
    assert.doesNotMatch(src, /The git-agent NEVER touches `staging\/<task-slug>`/);
    assert.doesNotMatch(mirror, /The git-agent NEVER touches `staging\/<task-slug>`/);
  });

  test('documents the sole staging exception: create from origin/alpha + non-force push', () => {
    assert.match(src, /Staging Branch Initialization/);
    assert.match(src, /git branch staging\/<task-slug> origin\/alpha/);
    assert.match(src, /git push origin staging\/<task-slug>/);
    assert.match(src, /never check it out, commit to it, or push it again/);
  });

  test('still forbids force-push and main/master/alpha', () => {
    assert.match(src, /`git push --force` — NEVER/);
    assert.match(src, /NEVER push to, commit to, or modify `main`, `master`, or `alpha`/);
  });

  test('opencode mirror carries the same staging-init language', () => {
    assert.match(mirror, /Staging Branch Initialization/);
  });
});

describe('new-task: creates + pushes staging up front', () => {
  const wf = read('jelou/workflows/new-task.md');

  test('15c creates staging from origin/alpha and pushes it', () => {
    assert.match(wf, /git branch staging\/<TASK_SLUG> origin\/alpha/);
    assert.match(wf, /git push origin staging\/<TASK_SLUG>/);
  });

  test('records the creation alpha SHA and seeds sync markers', () => {
    assert.match(wf, /CREATION_ALPHA_SHA=\$\(git rev-parse origin\/alpha\)/);
    assert.match(wf, /alpha=<creation_alpha_sha>, production=/);
  });

  test('report no longer says staging is synthesized at create-pr', () => {
    assert.doesNotMatch(wf, /will be synthesized automatically during `\/jlu-create-pr`/);
    assert.match(wf, /was created from `origin\/alpha` and pushed/);
  });

  test('quick-ref table marks staging as created at new-task', () => {
    assert.doesNotMatch(wf, /`staging\/<task-slug>` \(synthesized at first `\/jlu-create-pr`/);
    assert.match(wf, /created from `origin\/alpha` and pushed at `\/jlu-new-task` Step 15c/);
  });
});

describe('create-pr: reuses the pre-created staging branch', () => {
  const wf = read('jelou/workflows/create-pr.md');

  test('5b.3 has a first-pick path that reuses the existing branch', () => {
    assert.match(wf, /\*\*first-pick\*\*/);
    assert.match(wf, /first cherry-pick onto the branch `\/jlu-new-task` pre-created/);
  });

  test('SYNC_MODE enumerates first-pick alongside rebuild/incremental/no-op', () => {
    assert.match(wf, /SYNC_MODE ∈ \{rebuild, first-pick, incremental, no-op\}/);
  });

  test('worktree prep and push reuse the branch for first-pick + incremental', () => {
    assert.match(wf, /SYNC_MODE ∈ \{first-pick, incremental\}/);
  });

  test('marker parser tolerates an empty production value', () => {
    assert.match(wf, /empty `production` means no commits have been cherry-picked yet/);
  });
});

describe('close-task: tears down eagerly-pushed staging', () => {
  const wf = read('jelou/workflows/close-task.md');

  test('staging teardown runs whenever DUAL_PR = yes, not only when an alpha PR was recorded', () => {
    assert.match(wf, /\*\*Staging branch teardown\*\* \(whenever `DUAL_PR = yes`\)/);
    assert.match(wf, /the remote branch can exist even if `\/jlu-create-pr` never ran/);
  });

  test('handles the no-alpha-PR case explicitly', () => {
    assert.match(wf, /no alpha PR was ever opened/);
  });
});

describe('report-task: stale-branch net covers staging', () => {
  const wf = read('jelou/workflows/report-task.md');

  test('stale branch-mode check verifies staging as well as production', () => {
    assert.match(wf, /git -C <service-repo> rev-parse --verify staging\/<TASK_SLUG> 2>\/dev\/null/);
    assert.match(wf, /dual-PR tasks created but never carried through/);
  });
});

describe('README: dual-PR section reflects eager creation', () => {
  const readme = read('README.md');

  test('no longer calls staging synthesized on-demand', () => {
    assert.doesNotMatch(readme, /synthesized on-demand: cut from `origin\/alpha`/);
  });

  test('describes staging as created up-front and pushed', () => {
    assert.match(readme, /created up-front by `\/jlu-new-task`: cut from `origin\/alpha` and pushed/);
  });
});

describe('jlu-tasks-agent: TASKS.md template reflects eager creation', () => {
  const src = read('agents/jlu-tasks-agent.md');
  const mirror = read('.opencode/agents/jlu-tasks-agent.md');

  test('secondary-branch template is not described as synthesized at create-pr', () => {
    assert.doesNotMatch(src, /synthesized at first \/jlu-create-pr/);
    assert.doesNotMatch(mirror, /synthesized at first \/jlu-create-pr/);
  });

  test('secondary branch template says created at new-task', () => {
    assert.match(src, /created from origin\/alpha and pushed at \/jlu-new-task Step 15c/);
  });
});
