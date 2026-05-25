# Finalize-Phase Untracked Files + Format Detection Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two production-confirmed bugs in the execute-task orchestrator's host-side helper scripts:

1. `bin/finalize-phase.sh` silently drops **untracked new files** because it sources its file list from `git diff --name-only HEAD`. Phases that create new files (test files, new modules) need manual follow-up commits — observed on Phases 01, 02, 03a in a real run.
2. `bin/format-changed-files.sh` parses CONVENTIONS.md too eagerly: the first backtick-quoted token in the Formatting section that contains a formatter substring (`prettier`, `eslint`, `biome`, …) is treated as the command. Config filenames like `` `.prettierrc` ``, `` `biome.json` `` win the match — the script then tries to execute the JSON file as a shell command and the format step fails. Confirmed on the real `jelou-apps` CONVENTIONS.md where `` `biome.json` `` is picked instead of `biome check …`.

**Architecture:** Two surgical edits to two Bash scripts in `bin/`, each guarded by a new failing test in the corresponding `tests/unit/*.test.mjs` file. No public interface changes — env var contract, exit codes, and stdout `key=value` shape are preserved. Bump to `0.3.168` and document in CHANGELOG.

**Tech Stack:** Bash (POSIX-ish, `set -euo pipefail`), `node:test` unit tests with `spawnSync('bash', …)`.

**Current version (lock at):** `0.3.168` — next sequential patch above main `0.3.167`. Every commit on this branch uses `[skip-bump]`; the final commit on the merging side handles the version bump.

---

## Background — Why these bugs hide

Both bugs share a root cause: **tests cover only the happy-path shape and never the data variation that exposes the bug.**

- `tests/unit/finalize-phase.test.mjs` always seeds the repo with `a.ts` + `b.ts` pre-committed (`setupRepo`), then modifies them. No test ever introduces a brand-new untracked file as part of `FINALIZE_EXPECTED`, so `git diff --name-only HEAD` returning an incomplete list is invisible.
- `tests/unit/format-changed-files.test.mjs:191-224` already has a CONVENTIONS.md test, but the fixture says `Run \`prettier --write\` against staged files.` — the FIRST backtick token in that section is the real command. No test crafts a section where the first backtick is a config filename followed by a separate command line.

Reproducer commands (informational, do not commit):

```bash
# Bug 1 — untracked files missing from diff
cd /tmp/x && git init -q && git checkout -q -b production/foo \
  && echo a > a.ts && git add a.ts && git commit -qm seed \
  && echo new > new.ts && echo mod >> a.ts \
  && git diff --name-only HEAD   # prints only a.ts, never new.ts

# Bug 2 — awk picks the config filename
awk '/^#+ *(Format|Lint|Formatting|Linting)/ { in_section=1; next }
     in_section && /^#+ / { in_section=0 }
     in_section && /`[^`]+`/ {
       match($0, /`[^`]+`/)
       cmd = substr($0, RSTART+1, RLENGTH-2)
       if (cmd ~ /(prettier|eslint|biome|rome|black|ruff|gofmt|rustfmt|format|lint)/) {
         print cmd; exit
       }
     }' < <(printf '## Formatting\n| Indent | 4 | `biome.json` |\n`biome check --error-on-warnings`\n')
# Output: biome.json  ← bug
```

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `tests/unit/finalize-phase.test.mjs` | Modify | Add 2 failing tests covering untracked file scenarios (single new file + mixed modified+new). |
| `bin/finalize-phase.sh` | Modify | Replace `git diff --name-only HEAD` with a combined source that includes untracked-but-not-ignored files. |
| `tests/unit/format-changed-files.test.mjs` | Modify | Add 2 failing tests: `.prettierrc` precedes the real command; `biome.json` precedes `biome check`. |
| `bin/format-changed-files.sh` | Modify | Tighten the awk match to require a runner verb (rejects bare config filenames like `.prettierrc`, `biome.json`, `.eslintrc.json`). |
| `CHANGELOG.md` | Modify | New `## [0.3.168] — 2026-05-25` entry. |
| `package.json` | Modify | Bump version to `0.3.168` (handled by the standard release pipeline; not by the per-task commits). |

Tests-first per fix. No new files created.

---

## Task 1 — finalize-phase.sh: include untracked files in scope check, staging, and commit

**Files:**
- Modify: `tests/unit/finalize-phase.test.mjs`
- Modify: `bin/finalize-phase.sh:87` (the `DIFF_FILES=` line) and `bin/finalize-phase.sh:155` (the line-count for `files_committed`, which must still match `DIFF_FILES`).

### Step 1: Add failing tests (RED)

- [ ] **Step 1.1:** In `tests/unit/finalize-phase.test.mjs`, inside the existing `describe('finalize-phase.sh — happy path', …)` block (or a new `describe('finalize-phase.sh — untracked files', …)`), add the following two tests:

```mjs
test('stages and commits an untracked new file declared in FINALIZE_EXPECTED', () => {
  const dir = setupRepo();
  try {
    // new.ts is brand-new — never tracked before this phase
    writeFileSync(join(dir, 'new.ts'), 'fresh\n');
    const r = runScript({
      ...BASE_ENV,
      FINALIZE_SOURCE_PATH: dir,
      FINALIZE_EXPECTED: 'new.ts',
    });
    assert.equal(r.code, 0, `expected ok, got:\n${r.stdout}\n${r.stderr}`);
    assert.equal(r.parsed.status, 'ok');
    assert.equal(r.parsed.files_committed, '1');
    // Verify the file is actually in the commit, not just unstaged on disk.
    const showed = git(dir, 'show', '--name-only', '--format=', 'HEAD').trim();
    assert.equal(showed, 'new.ts');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles a mix of modified and untracked files in one phase', () => {
  const dir = setupRepo();
  try {
    writeFileSync(join(dir, 'a.ts'), 'hello\nmod\n');         // modified tracked
    writeFileSync(join(dir, 'newSpec.ts'), 'spec\n');         // untracked new
    const r = runScript({
      ...BASE_ENV,
      FINALIZE_SOURCE_PATH: dir,
      FINALIZE_EXPECTED: 'a.ts\nnewSpec.ts',
    });
    assert.equal(r.code, 0, `expected ok, got:\n${r.stdout}\n${r.stderr}`);
    assert.equal(r.parsed.status, 'ok');
    assert.equal(r.parsed.files_committed, '2');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 1.2:** Also add ONE regression test in the existing `describe('finalize-phase.sh — scope check', …)` block to lock in that untracked files NOT in `FINALIZE_EXPECTED` still trigger an abort:

```mjs
test('aborts when an untracked file is not declared in FINALIZE_EXPECTED', () => {
  const dir = setupRepo();
  try {
    writeFileSync(join(dir, 'a.ts'), 'hello\nmod\n');
    writeFileSync(join(dir, 'sneaky.ts'), 'oops\n');   // untracked, undeclared
    const r = runScript({
      ...BASE_ENV,
      FINALIZE_SOURCE_PATH: dir,
      FINALIZE_EXPECTED: 'a.ts',
    });
    assert.equal(r.code, 2);
    assert.equal(r.parsed.status, 'abort');
    assert.equal(r.parsed.reason, 'unexpected_files_in_diff');
    assert.match(r.parsed.unexpected_files, /sneaky\.ts/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 1.3:** Run `npm test` and confirm all three new tests FAIL with messages indicating `new.ts`/`newSpec.ts`/`sneaky.ts` is not visible to the script (reason will be `no_changes` for the first two, and `unexpected_files_in_diff` won't list `sneaky.ts` for the third).

### Step 2: Fix the script (GREEN)

- [ ] **Step 2.1:** In `bin/finalize-phase.sh`, replace the single-line definition on line 87:

```bash
DIFF_FILES="$(git diff --name-only HEAD)"
```

with:

```bash
# Tracked-but-modified + untracked-but-not-ignored. Sorted/de-duplicated.
# Untracked files are how phases deliver new test files and new modules; without
# `ls-files --others --exclude-standard` they would be silently dropped from the
# scope check, the staging loop, and the commit.
DIFF_FILES="$( {
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } | LC_ALL=C sort -u )"
```

- [ ] **Step 2.2:** Verify the rest of the script remains correct:
  - Lines 89-94 (`no_changes` abort) — still correct: empty union means nothing to do.
  - Lines 119-134 (scope check against allowlist) — still correct: now also validates untracked files against `FINALIZE_EXPECTED`.
  - Lines 139-142 (`git add` loop) — still correct: `git add <path>` works for both tracked and untracked.
  - Line 155 (`grep -c '^'` for `files_committed`) — still correct: counts non-empty lines in the union.

- [ ] **Step 2.3:** Run `npm test` and confirm all three new tests now PASS and no existing tests broke.

### Step 3: Commit

- [ ] **Step 3.1:**
  ```bash
  git add tests/unit/finalize-phase.test.mjs bin/finalize-phase.sh
  git commit -m "fix(finalize-phase): include untracked files in scope check + commit [skip-bump]"
  ```

---

## Task 2 — format-changed-files.sh: reject config filenames in CONVENTIONS.md awk

**Files:**
- Modify: `tests/unit/format-changed-files.test.mjs`
- Modify: `bin/format-changed-files.sh:73-84` (the awk block).

### Step 1: Add failing tests (RED)

- [ ] **Step 1.1:** In `tests/unit/format-changed-files.test.mjs`, inside `describe('format-changed-files.sh — detection chain (dry-run)', …)`, add two new tests after the existing "CONVENTIONS.md format command takes priority over package.json" test:

```mjs
test('CONVENTIONS.md: skips bare config filenames like `.prettierrc` and picks the real command', () => {
  const dir = mktmp();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: {} }));
    const convPath = join(dir, 'CONVENTIONS.md');
    writeFileSync(convPath, [
      '# Conventions',
      '',
      '## Formatting',
      '',
      'The project uses `.prettierrc` for configuration.',
      'To format the code, run `npx prettier --write`.',
      '',
      '## Other',
      '',
      'Stuff.',
    ].join('\n'));
    writeFileSync(join(dir, 'a.ts'), 'x\n');
    const r = runScript({
      FORMAT_SOURCE_PATH: dir,
      FORMAT_CHANGED_FILES: 'a.ts',
      FORMAT_CONVENTIONS: convPath,
      FORMAT_DRY_RUN: '1',
    });
    assert.equal(r.code, 0, `expected ok, got: ${r.stdout}\n${r.stderr}`);
    assert.equal(r.parsed.detection_source, 'conventions');
    assert.match(r.parsed.command, /npx prettier --write/);
    assert.doesNotMatch(r.parsed.command, /\.prettierrc/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CONVENTIONS.md: skips `biome.json` in tables and picks `biome check` (jelou-apps shape)', () => {
  const dir = mktmp();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: {} }));
    const convPath = join(dir, 'CONVENTIONS.md');
    // Mirrors the real jelou-apps CONVENTIONS.md structure: a table whose first
    // backtick token is `biome.json` (the config), followed later by the actual
    // pre-commit command `biome check ...`.
    writeFileSync(convPath, [
      '# Conventions',
      '',
      '## Formatting',
      '',
      '| Rule | Value | Source |',
      '|------|-------|--------|',
      '| Indentation | 4 spaces | `biome.json`, `.editorconfig` |',
      '',
      '**Pre-commit enforcement**: `lint-staged` runs `biome check --error-on-warnings --no-errors-on-unmatched` on staged files.',
      '',
      '## Other',
      '',
      'Stuff.',
    ].join('\n'));
    writeFileSync(join(dir, 'a.ts'), 'x\n');
    const r = runScript({
      FORMAT_SOURCE_PATH: dir,
      FORMAT_CHANGED_FILES: 'a.ts',
      FORMAT_CONVENTIONS: convPath,
      FORMAT_DRY_RUN: '1',
    });
    assert.equal(r.code, 0, `expected ok, got: ${r.stdout}\n${r.stderr}`);
    assert.equal(r.parsed.detection_source, 'conventions');
    assert.match(r.parsed.command, /biome check/);
    assert.doesNotMatch(r.parsed.command, /^biome\.json\b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 1.2:** Run `npm test` and confirm the `.prettierrc` case fails with `command=.prettierrc <files>` and the `biome.json` case fails with `command=biome.json <files>` — exactly the bug.

### Step 2: Fix the awk (GREEN)

- [ ] **Step 2.1:** In `bin/format-changed-files.sh`, replace the awk block at lines 73-84:

```bash
CONV_CMD="$(awk '
  /^#+ *(Format|Lint|Formatting|Linting)/ { in_section=1; next }
  in_section && /^#+ / { in_section=0 }
  in_section && /`[^`]+`/ {
    match($0, /`[^`]+`/)
    cmd = substr($0, RSTART+1, RLENGTH-2)
    if (cmd ~ /(prettier|eslint|biome|rome|black|ruff|gofmt|rustfmt|format|lint)/) {
      print cmd
      exit
    }
  }
' "$FORMAT_CONVENTIONS" 2>/dev/null || true)"
```

with:

```bash
CONV_CMD="$(awk '
  # Activate inside Formatting/Lint sections (case-sensitive headings as before).
  /^#+ *(Format|Lint|Formatting|Linting)/ { in_section=1; next }
  in_section && /^#+ / { in_section=0 }
  # Scan every backtick token on the line — not just the first — so a config
  # filename mentioned before the real command does not shadow it.
  in_section {
    s = $0
    while (match(s, /`[^`]+`/)) {
      cmd = substr(s, RSTART+1, RLENGTH-2)
      s = substr(s, RSTART + RLENGTH)
      # Accept only actual commands. A command starts with a known runner /
      # formatter followed by whitespace and at least one argument. Bare config
      # filenames (`.prettierrc`, `biome.json`, `.eslintrc.json`) fail this test.
      if (cmd ~ /^(npm|npx|yarn|pnpm|bun|biome|prettier|eslint|rome|black|ruff|gofmt|rustfmt)[[:space:]]+\S/) {
        print cmd
        exit
      }
    }
  }
' "$FORMAT_CONVENTIONS" 2>/dev/null || true)"
```

Key changes:
1. Scan every backtick token on the matched line, not just the first — so a config filename earlier on the same line does not block a real command later on it.
2. Anchor with `^(runner)` and require `[[:space:]]+\S` after — bare config filenames (no whitespace+arg) are rejected.
3. Drop the loose `format|lint` substring branch — it produced false positives on words like `lint-staged` appearing as bare backticks (still matched by `npx`/`npm`/`yarn`/`pnpm` runners if those are present, which is the documented pattern).

- [ ] **Step 2.2:** Verify the existing "CONVENTIONS.md format command takes priority over package.json" test (line 191) still passes — its fixture writes `` `prettier --write` `` which matches the new anchored pattern.

- [ ] **Step 2.3:** Run `npm test` and confirm the two new tests now pass and no existing tests broke.

### Step 3: Commit

- [ ] **Step 3.1:**
  ```bash
  git add tests/unit/format-changed-files.test.mjs bin/format-changed-files.sh
  git commit -m "fix(format-changed-files): require runner+arg in CONVENTIONS.md command parse [skip-bump]"
  ```

---

## Task 3 — Changelog + version

- [ ] **Step 1: Add a CHANGELOG entry**

At the top of `CHANGELOG.md`, insert a new section above `## [0.3.167]`:

```markdown
## [0.3.168] — 2026-05-25

### Fixed

- **`bin/finalize-phase.sh` now includes untracked files in scope check, staging, and commit.** The script previously sourced its file list from `git diff --name-only HEAD`, which omits untracked files. Phases that produced brand-new files (test files, new modules) silently failed scope validation, were not staged, and required a manual follow-up commit — observed on Phases 01/02/03a of real runs. The fix unions `git diff --name-only HEAD` with `git ls-files --others --exclude-standard`, sorted and de-duplicated. The allowlist (`FINALIZE_EXPECTED` + known auto-staged manifests) is now applied to untracked files too: undeclared new files still abort with `reason=unexpected_files_in_diff`. Three new unit tests cover declared-untracked, mixed modified+untracked, and undeclared-untracked.
- **`bin/format-changed-files.sh` no longer treats config filenames as the format command.** The CONVENTIONS.md awk previously took the first backtick-quoted token in a Formatting section that matched any of `prettier|eslint|biome|…` — config filenames like `` `.prettierrc` ``, `` `biome.json` ``, `` `.eslintrc.json` `` won the match and the script tried to execute the JSON file as a shell command. Confirmed on real-world `jelou-apps` CONVENTIONS.md where `` `biome.json` `` appears in the formatting table before the real `biome check` command. The fix scans every backtick token on each in-section line and requires the token to start with a known runner (`npm`, `npx`, `yarn`, `pnpm`, `bun`, `biome`, `prettier`, `eslint`, `rome`, `black`, `ruff`, `gofmt`, `rustfmt`) followed by whitespace and at least one argument. Bare filenames are rejected. Two new unit tests cover `.prettierrc` and `biome.json` shapes.

### Internal

- No agent prompts changed. No public CLI contract changes (env vars, exit codes, stdout `key=value` shape preserved).
```

- [ ] **Step 2: Bump version**

```bash
npm version 0.3.168 --no-git-tag-version
```

This updates `package.json` and (if present) `package-lock.json`.

- [ ] **Step 3: Commit the release prep**

```bash
git add CHANGELOG.md package.json package-lock.json
git commit -m "release: 0.3.168 — finalize-phase untracked files + format detection fixes"
```

> **Note:** Per the user's `feedback_release_after_push_to_main` memory: after merging to `main`, immediately tag `v0.3.168` and create a GitHub Release with notes from the new CHANGELOG section. That is handled by the post-merge workflow, not by this plan.

---

## Final Verification

- [ ] **Step 1:** `npm test` — all unit tests pass (current 564 + 5 new = 569).
- [ ] **Step 2:** `node bin/sync-agents.mjs --check` — confirms `.opencode/agents/` is in sync (no agent prompts touched, should pass trivially).
- [ ] **Step 3:** Manual smoke against the real `jelou-apps` CONVENTIONS.md:
  ```bash
  FORMAT_SOURCE_PATH=/home/cristianp/jelou-projects/jelou-apps \
  FORMAT_CHANGED_FILES=$'libs/brain/src/lib/Components/Studio/StudioView.tsx' \
  FORMAT_CONVENTIONS=/home/cristianp/jelou-projects/.spec-workspace/services/jelou-apps/codebase/CONVENTIONS.md \
  FORMAT_DRY_RUN=1 \
    bash bin/format-changed-files.sh
  ```
  Expected stdout includes `command=biome check --error-on-warnings --no-errors-on-unmatched libs/...`.
- [ ] **Step 4:** Per CLAUDE.md pre-push checklist: `npm test` AND `node bin/sync-agents.mjs --check` must both pass before pushing to `main`.

---

## Out of Scope

- Generalizing the format-command detection beyond CONVENTIONS.md (e.g., reading `.editorconfig`, `biome.json` directly). The current detection chain (CONVENTIONS.md → package.json scripts → JS/TS default) is preserved.
- Auto-fixing existing CONVENTIONS.md files in user workspaces. The new awk is forward-compatible with the current jelou-apps file — no edits needed there.
- Adding a `git add -A` shortcut in finalize-phase.sh. The fix specifically preserves the scope check: untracked files still must be declared in `FINALIZE_EXPECTED` to be accepted.
- Rewriting either script in Node or another language.
