// tests/unit/worktree-resolution-modes.test.mjs
//
// Structural assertion that path-resolution sections in every workflow that
// touches a task's source tree respect SETUP_MODE (from TASKS.md → ## Branching
// → Mode) instead of doing a bare filesystem existence check on .worktrees/.
//
// Regression guard for: branch-mode tasks were running tests inside
// .worktrees/<TASK_SLUG>/ when a leftover worktree happened to exist on disk,
// because the inline parenthetical in each workflow said "worktree if
// .worktrees/<TASK_SLUG> exists, else main repo" — which ignored the mode.
// The canonical algorithm in references/worktree-resolution.md has always been
// mode-driven; the individual workflows must echo that, not contradict it.
//
// Run: `node --test tests/unit/worktree-resolution-modes.test.mjs`

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

const WORKFLOWS = [
  'jelou/workflows/execute-task.md',
  'jelou/workflows/ship.md',
  'jelou/workflows/load-context.md',
];

describe('worktree-resolution reference', () => {
  const ref = read('jelou/references/worktree-resolution.md');

  test('canonical algorithm is mode-driven', () => {
    assert.match(ref, /If `Mode: worktree`/);
    assert.match(ref, /If `Mode: branch`/);
  });

  test('branch mode resolves to the service repo root', () => {
    assert.match(ref, /Mode: branch[^\n]*service repo root/i);
  });
});

describe('workflows respect SETUP_MODE in path resolution', () => {
  for (const path of WORKFLOWS) {
    describe(path, () => {
      const wf = read(path);

      test('explicitly names both modes in the path-resolution language', () => {
        assert.match(wf, /Mode: worktree/);
        assert.match(wf, /Mode: branch/);
      });

      test('branch mode resolves to the main repo (no .worktrees/ path)', () => {
        // The workflow must spell out that branch mode means main repo root.
        // We accept any phrasing that pairs "Mode: branch" with "main repo"
        // within a short window — short enough that the line is actually
        // about that pairing, not coincidental matches elsewhere.
        const branchClause = /Mode: branch[\s\S]{0,400}main repo/;
        assert.match(wf, branchClause);
      });

      test('does NOT use a bare filesystem-existence check as the resolution rule', () => {
        // The buggy phrasings to forbid. These are the exact shapes that
        // caused branch-mode tasks to pick .worktrees/ when a leftover dir
        // existed. New language must be mode-driven, not existence-driven.
        const buggyPhrasings = [
          /worktree if `<service-repo>\/\.worktrees\/<TASK_SLUG>` exists, else service main repo/i,
          /Check if a worktree exists:\s*`<service-repo>\/\.worktrees\/<TASK_SLUG>`\s*[\r\n]+\s*(?:3\.|-)\s*If worktree exists:\s*use it/i,
          /Check if worktree exists:\s*`<service-repo>\/\.worktrees\/<TASK_SLUG>`\s*[\r\n]+\s*(?:3\.|-)\s*If worktree exists:\s*use it/i,
          /Check if `<service-repo>\/\.worktrees\/<TASK_SLUG>\/` exists \(using the task slug from Step 1\)\.\s*[\r\n]+\s*(?:c\.|3\.|-)\s*If it exists:\s*record the worktree path/i,
        ];
        for (const re of buggyPhrasings) {
          assert.doesNotMatch(
            wf,
            re,
            `workflow ${path} still contains a buggy filesystem-only path-resolution clause matching ${re}`
          );
        }
      });

      test('warns / logs when branch mode encounters a leftover worktree', () => {
        // Defense-in-depth: when Mode: branch but .worktrees/<slug> happens to
        // exist on disk, the workflow must explicitly say it is ignored. This
        // prevents silent picks of the wrong directory. "leftover worktree"
        // is a distinctive phrase only used in these defensive logging lines,
        // so its presence is a reliable signal that the rule is documented.
        assert.match(wf, /leftover worktree/i);
      });
    });
  }
});
