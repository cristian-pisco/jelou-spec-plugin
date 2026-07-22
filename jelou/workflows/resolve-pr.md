# /jlu:resolve-pr Workflow

> Purpose: drive the open PR(s) of the current branch to green. Resolves merge
> conflicts with the base branch, addresses review comments (humans and bots —
> CodeRabbit, Sonar, dependabot — are first-class), diagnoses and fixes failing
> CI jobs, and — when the repository uses SonarQube — clusters and fixes Sonar
> quality issues by root cause. One push per cycle, bounded re-check loop,
> explicit escalation for everything that requires human judgment.

Inputs:
- `argument`: optional PR URL or number (overrides branch detection), plus the
  optional flag `--autonomous`.
- `cwd`: the user's current working directory (must be inside the target repo).

---

## Modes

**interactive** (default). Every ask-path below uses `question` and waits for
the user. This is the drop-in replacement for the personal
`resolve-pr-comments` + `sonar-pr-review` skills.

**autonomous** (`--autonomous`). The workflow NEVER prompts. On every ask-path
the only allowed actions are **skip, rerun, or escalate — never apply** — this
overrides any recommendation the interactive tables produce. Deterministic
categories that interactive mode applies WITHOUT asking (bugfix/improvement
comments, suggestion blocks, lint/typecheck/build/simple-unit CI fixes,
MECHANICAL Sonar clusters) still auto-apply: they are not ask-paths. Two
interactive auto-apply categories are demoted in autonomous mode because they
are judgment by doctrine: **security** comments and **SECURITY** Sonar clusters
escalate instead of applying.

Autonomous mode adds three behaviors interactive mode does not have:

1. **Dirty working tree** in the target checkout → escalate immediately (no
   stash/commit/include question).
2. **Conflict ask-paths abort first**: any conflict that would ask the user
   (deleted-vs-modified, binary, incompatible semantics) runs
   `git merge --abort` BEFORE escalating, so no conflict markers or in-progress
   merge are ever left behind.
3. **Review-arrival gate + both-halves done-gate** (Steps 4 and 11).

**Escalation format** (autonomous). Every escalation appends one block to the
final report and fires an OS notification:

```
ESCALATION
  PR: <url>
  Signal: <class> — <one-line description>
  Attempted: <what the loop did before stopping>
  Resume: /jlu-resolve-pr <pr-url>
```

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/notify.mjs').then((m) =>
  m.notifyOs({ title: 'jlu-resolve-pr', body: process.argv[1] })
);
" "Escalation on PR #<n>: <one-line signal>"
```

The OS notification is best-effort — a missing notifier module or binary never
blocks or drops the escalation record in the report.

Escalations never abort the whole run: the loop records them, skips that item,
and continues with the remaining work. The PR is NOT declared green while any
escalation is unresolved.

---

## Step 1 — Preconditions

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || { echo "Not a git repository."; exit 1; }
gh auth status >/dev/null 2>&1 \
  || { echo "GitHub CLI not authenticated. Run: gh auth login"; exit 1; }

BRANCH=$(git branch --show-current)
OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO=$(gh repo view --json name --jq '.name')
```

**Working tree state.** If `git status --porcelain` is non-empty:
- interactive: ask via `question` — (s)tash, (c)ommit first, or (i)nclude in
  the final commit. Do not proceed until answered. If the PR later turns out
  CONFLICTING and the user chose (i), stash → merge → pop; if the pop
  conflicts, resolve with the Step 3.3 procedure (ours = merged tree, theirs =
  stashed changes), then drop the stash entry.
- autonomous: escalate (`dirty-working-tree`) and stop this PR.

## Step 2 — Resolve target PR(s)

If `argument` contains a PR number or URL, use it (extract the number from a
URL). Otherwise:

```bash
gh pr list --head "$BRANCH" --state open \
  --json number,title,url,isDraft,baseRefName
```

- 0 results → stop: `No open PR linked to branch $BRANCH.`
- 1 result → use it.
- N results → announce the list and process each PR sequentially through the
  rest of this workflow. If the PRs have DIFFERENT `baseRefName` values, do
  NOT run Step 3 for any of them — merging multiple bases into one head
  branch cross-contaminates every PR sharing it. Interactive: ask which base
  to merge (or none); autonomous: escalate (`multi-base-branch`) and process
  comments/CI only.

**Fork guard.** Read `headRepositoryOwner` and `isCrossRepository` via
`gh pr view "$PR_NUMBER" --json headRepositoryOwner,isCrossRepository`. If the
PR head lives in a repository the local checkout cannot push to, restrict the
whole run for that PR to **reply-only handling**: no merge, no code
application, no push — threads may be answered, everything else is reported
(interactive) or escalated (`fork-pr-not-pushable`, autonomous).

Record the remote baseline for the push guard (refreshed after every push):

```bash
git fetch origin "$BRANCH" >/dev/null 2>&1 || true
LAST_SEEN_SHA=$(git rev-parse "origin/$BRANCH" 2>/dev/null || git rev-parse HEAD)
```

## Step 3 — Detect & resolve merge conflicts

Conflicts run BEFORE comments so comment fixes land on merged code.

```bash
gh pr view "$PR_NUMBER" --json mergeable,mergeStateStatus
```

| `mergeable` | Action |
|---|---|
| `MERGEABLE` | Skip to Step 4 |
| `CONFLICTING` (or `mergeStateStatus: DIRTY`) | Run 3.1 → 3.6 |
| `UNKNOWN` | Retry up to 3 times with `sleep 5`; if still UNKNOWN, warn and continue to Step 4 |

### 3.1 Start the merge

Always merge the base INTO the PR branch. **Never rebase** — it rewrites
shared history and forces a force-push.

```bash
BASE=$(gh pr view "$PR_NUMBER" --json baseRefName --jq .baseRefName)
git fetch origin "$BASE"
git merge "origin/$BASE" || true
git diff --name-only --diff-filter=U
```

If `git fetch` fails, skip conflict resolution with a clear message and
continue to Step 4. If the merge completes cleanly, keep the merge commit and
continue.

### 3.2 Classify each conflicted file

Process in this order: lockfiles → text → binary/delete cases.

| Case | Detection | Strategy |
|---|---|---|
| Lockfile | `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `uv.lock`, `Gemfile.lock`, `composer.lock`, `go.sum` | Regenerate (3.5) — never hand-edit |
| Both modified / both added | code `UU` / `AA` | Semantic merge (3.3) |
| Deleted on one side, modified on the other | code `DU` / `UD` | Ask-path (3.4) |
| Binary file | `git diff` reports binary | Ask-path (3.4) |

### 3.3 Semantic merge (UU / AA)

Read `git show ":1:$FILE"` (base), `":2:$FILE"` (ours = PR), `":3:$FILE"`
(theirs = base branch) plus the working-tree file with markers. Resolve so
BOTH intents survive:

- Independent/adjacent changes (imports, list entries, routes, config keys) →
  keep both in a sensible order.
- Base renamed a symbol the PR uses → adopt the rename, then
  `git grep -n "oldName"` for stale references beyond the conflicted hunk.
- One side reformatted, the other changed logic → keep the logic, apply the
  formatting.
- **Incompatible semantics** → ask-path: interactive goes to 3.4; autonomous
  runs `git merge --abort`, escalates (`conflict-incompatible-semantics`), and
  continues with comment processing on the unmerged branch.

Stage with `git add "$FILE"` only when zero markers remain.

### 3.4 Conflict ask-path

Interactive: present the file, both sides, and a recommendation; apply the
user's (o)urs / (t)heirs / (m)anual choice. The deleted side of DU/UD is
always `git rm`, never checkout.

Autonomous: `git merge --abort` first, then escalate
(`conflict-needs-judgment: <path> (<type>)`), then continue to Step 4.

### 3.5 Lockfiles

`git checkout --theirs "$LOCKFILE" && git add "$LOCKFILE"`, then after the
manifest is resolved check `git diff MERGE_HEAD -- package.json`; non-empty →
regenerate (`npm install --package-lock-only`, `pnpm install --lockfile-only`,
`yarn install --mode update-lockfile`, `cargo generate-lockfile`,
`poetry lock --no-update`, `uv lock`, `go mod tidy`) and stage. If the package
manager is missing locally AND the merged manifest differs from theirs, the
theirs-lockfile is known-inconsistent and would guarantee a `npm ci`/frozen-
lockfile red on the next CI cycle — this is an ask-path: interactive asks how
to proceed; autonomous runs `git merge --abort` and escalates
(`conflict-lockfile-unregenerable`). Never commit a lockfile that no longer
matches its manifest.

### 3.6 Verify & commit the merge

```bash
git diff --check
git diff --name-only --diff-filter=U
```

Both must be clean. Run the repo's cheap typecheck/lint on resolved files if
one exists (Step 9 table). Then `git commit --no-edit`. Do NOT push yet — the
single push happens in Step 10.

Escape hatch: `git merge --abort` restores the pre-merge state at any point;
report it and continue with comments on the unmerged branch.

## Step 4 — Review-arrival gate (autonomous only)

Review bots (CodeRabbit, Sonar) post asynchronously, minutes after PR creation
and again after every push. Skipping this gate makes the loop find zero
threads and declare a false green.

Poll every 30s, bounded by `review_wait` (default 600s):

```bash
HEAD_SHA=$(git rev-parse HEAD)
gh api "repos/$OWNER/$REPO/pulls/$PR_NUMBER/reviews" \
  --jq "[.[] | select(.commit_id == \"$HEAD_SHA\")] | length"
gh pr checks "$PR_NUMBER" --json name,state,bucket 2>/dev/null
```

The gate opens when ANY holds:
- at least one review exists **on the current head SHA** (the `commit_id`
  filter above — reviews on earlier pushes do not count, otherwise any PR
  with review history opens the gate instantly on every re-entry), or
- at least one check whose name matches `coderabbit|sonar` (case-insensitive)
  exists AND every such check reached a terminal state (zero matching checks
  never satisfies this condition — many CodeRabbit setups post reviews, not
  checks), or
- `review_wait` expired (record `review_gate: timeout` in the report — a repo
  without review bots hits this once and proceeds).

Interactive mode skips this gate: the human decides when to run the skill.

## Step 5 — Fetch review threads

Query threads via GraphQL (REST does not expose `isResolved`):

```bash
gh api graphql -F owner="$OWNER" -F repo="$REPO" -F pr="$PR_NUMBER" -F after="$CURSOR" -f query='
query($owner: String!, $repo: String!, $pr: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          comments(first: 100) {
            nodes { databaseId body path line originalLine diffHunk author { login } url }
          }
        }
      }
    }
  }
}'
```

Paginate: start with `after` null and repeat with `endCursor` while
`hasNextPage` is true — a CodeRabbit round on a large diff routinely exceeds
100 threads, and dropping the tail would let the done-gate declare green with
unfetched actionable threads.

Filter: skip `isResolved` and `isOutdated` threads; include bot authors
(coderabbitai, sonarqubecloud, dependabot, github-actions, …) as first-class.
Skip threads whose first comment's `databaseId` is already in this run's
handled-ids set (re-fetches must not re-fix). Announce the actionable count.

Zero actionable threads → go directly to Step 7 (red CI can exist without
comments; a Step 3 merge commit may still need pushing).

## Step 6 — Per-thread loop

For each thread, sequentially (never batch): read context → classify → act →
reply → resolve.

**6.1 Read.** File at `path` centered on `line`, plus `diffHunk`. If Step 3
merged, locate code by content, not by trusting `line`. A
` ```suggestion ` block is the desired patch — apply verbatim when the
category is mandatory.

**6.2 Classify** — exactly ONE category:

| Category | Examples | Interactive | Autonomous |
|---|---|---|---|
| bugfix | null access, off-by-one, race, missing await | Apply | Apply |
| security | injection, XSS, secret, missing authz, weak crypto | Apply | **Escalate** |
| improvement | naming, dead code, simplification, missing test, error handling | Apply | Apply |
| extensive refactor | >3 files, public API change, new/moved abstraction, cross-file rename | Ask with PROs/CONS | **Escalate** |
| non-actionable | opinion, question, praise, out-of-scope | Reply only | Reply only |

**6.3 Apply or ask.** Mandatory categories: minimal diff, only what the
comment asks, never refactor surroundings. Extensive refactor: interactive
asks (apply on "s", skip-and-reply on "n"); autonomous escalates and replies
`Escalated for human review.` / `Escalado para revisión humana.`. Conflicting
comments (two threads contradict) are an ask-path: interactive presents both;
autonomous escalates both.

**6.4 Compose the reply** for the FIRST comment's `databaseId`. Detect
language (Spanish diacritics/stopwords → Spanish; else English). Templates:
applied → `Aplicado: <details>.` / `Applied: <details>.`;
declined/escalated → `Evaluado pero no aplicado: <razón>.` /
`Reviewed but not applied: <reason>.`; non-actionable →
`Gracias por el comentario. <respuesta>.`; duplicate →
`Ya cubierto por <ref>.` Under 2 sentences, no emojis unless the comment used
them.

**6.5 Queue or post.** Record the thread's first-comment id in the
handled-ids set now (so re-fetches never re-fix it), then:

- **Threads whose handling changed code** → QUEUE the reply + resolution.
  They are posted ONLY in Step 10.5, after the guarded push lands. Posting
  `Aplicado` and resolving before the push would let a blocked push (guard
  exit 2/3, crash, fork failure) leave GitHub claiming fixes the PR does not
  contain — and a resumed run would skip those resolved threads forever.
- **Threads with no code change** (non-actionable, duplicates,
  declined/escalated replies) → post the reply immediately. Resolve
  immediately too, except autonomous escalations, which stay unresolved so
  the human finds them.

Posting mechanics (used here for no-code threads and in Step 10.5 for the
queue):

```bash
gh api -X POST \
  "repos/$OWNER/$REPO/pulls/$PR_NUMBER/comments/$COMMENT_ID/replies" \
  -f body="$REPLY_BODY"
gh api graphql -F threadId="$THREAD_ID" -f query='
mutation($threadId: ID!) {
  resolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved } }
}'
```

On posting/mutation failure, log and continue — never roll back the code or
reply.

## Step 7 — Detect & fix failing CI jobs

Runs even with zero threads and no conflicts.

**7.1 Detect:**

```bash
gh pr checks "$PR_NUMBER" --json name,state,bucket,link,workflow 2>/dev/null
```

`bucket: "fail"` → handle; `"pending"` → mention, do not act; no checks
configured → Step 8. Announce the red count.

**7.2 Route by provider:**

| Provider | `link` / name pattern | Handling |
|---|---|---|
| SonarQube | check name or `link` host matches `sonar` (SonarCloud quality gate, sonarqube.* ) | Route to **Step 8** — never treated as an undiagnosable external provider |
| GitHub Actions | `github.com/<o>/<r>/actions/runs/<id>/…` | Diagnose via 7.3 |
| Other (CircleCI, Jenkins, Vercel, …) | any other host | Ask-path: interactive presents the `link`; autonomous escalates (`ci-non-gha-provider`) |

**7.3 Diagnose (GitHub Actions):**

```bash
RUN_ID=$(printf '%s' "$LINK" | sed -nE 's#.*/actions/runs/([0-9]+).*#\1#p')
gh run view "$RUN_ID" --log-failed
```

Empty logs or unparseable id → undiagnosable (7.5).

**7.4 Classify & act:**

| Failure class | Signal | Interactive | Autonomous |
|---|---|---|---|
| lint / format | eslint/biome/prettier/ruff errors | Auto-fix | Auto-fix |
| typecheck | tsc/mypy errors in PR-touched code | Auto-fix | Auto-fix |
| build / compile | webpack/vite/tsc/cargo/go failure attributable to the diff | Auto-fix | Auto-fix |
| unit test | assertion/`FAIL` pointing at a file in the diff | Auto-fix (minimal) | Auto-fix (minimal) — see test-integrity rule below |
| flaky / intermittent | timeout, `ECONNRESET`, "retrying" | Offer rerun | `gh run rerun --failed` once, then treat a second failure as real |
| infra / external | runner OOM, registry 5xx, missing secret | Report + ask | **Escalate** |
| broad / ambiguous | e2e needing live services, unclear root cause, extensive-refactor-sized fix | Ask | **Escalate** |

Auto-fix path: minimal edit, verify locally where cheap (matching Step 9 tool
on the touched files, or the single failing test file) before relying on CI.
A fix that cannot be validated locally must say so in the report.

**Test-integrity rule (both modes, mirrors Sonar 8.8):** a failing-test fix
changes production code or clearly-buggy test SETUP — it never weakens,
loosens, or deletes an assertion to match broken behavior. In autonomous
mode any fix that would change an assertion escalates
(`test-assertion-change`); in interactive mode it is an ask-path.

**7.5 Rerun / undiagnosable:** flaky/infra get `gh run rerun "$RUN_ID"
--failed`, never a code edit. Undiagnosable: interactive asks
(r)erun/(o)mit/wait; autonomous escalates (`ci-undiagnosable`).

## Step 8 — Sonar quality phase (gated)

**Gate.** Run this step only when the repository shows a Sonar signal:

- a check on the PR whose name or `link` matches `sonar` (any bucket), or
- `sonar-project.properties` or `.sonarlint/connectedMode.json` at the repo
  root, or a `sonar` profile in `pom.xml`/`build.gradle`, or
- a SonarQube MCP server reachable from the current runtime.

No signal → skip silently. Signal but NO tooling (MCP unavailable AND the
`sonar` CLI not authenticated): interactive warns and skips; autonomous
records a WARN in the report — and if the Sonar quality-gate check is red,
escalates (`sonar-gate-red-no-tooling`) since the loop cannot clear it.

**Tooling.** MCP-first. On Claude Code the tools are `mcp__sonarqube__*`
(load via `ToolSearch` when deferred); Codex/OpenCode expose them through
their MCP discovery surface. Fallback: `sonar` CLI
(`sonar list issues --project <key> --pull-request <n> --statuses OPEN,CONFIRMED --format json`).

**8.1 Scope.** Interactive: ask via `question` — **deep** (also fix
preexisting issues sharing a root cause with PR issues; structural multi-file
refactors allowed) or **shallow** (PR-scope only). Autonomous: always
**shallow** — PR-scope issues only, no refactor may touch files the PR didn't
already modify.

**8.2 Fetch.** Resolve the project key (`.sonarlint/connectedMode.json` →
`sonar-project.properties` → `pom.xml`/`build.gradle`/`package.json` → CI
files → `search_my_sonarqube_projects`). Then in parallel: issues on the PR
(`search_sonar_issues_in_projects` filtered by PR), hotspots
(`search_security_hotspots` — a separate API; never treat hotspots as issues),
baseline measures (`get_component_measures`: `duplicated_lines_density`,
`cognitive_complexity`, `coverage`, `new_coverage`), per-touched-file
`get_duplications`, and `get_project_quality_gate_status`. Deep mode
additionally pulls base-branch issues on the same files, tagged `preexisting`.

**8.3 Cluster by root cause** — never process issues one at a time:
duplication blocks (same `get_duplications` block identity across files, and
same rule + similar snippet for S4144/S1871/S1192), complexity (multiple
issues inside one function), same-file co-located (within 5 lines, same rule
family), fingerprint when exposed, singletons otherwise. Record per cluster:
root cause (one line), member issues (rule, file:line), files, whether any
member is `preexisting`.

**8.4 Classify each cluster** per
`{plugin-root}/jelou/references/sonar-risk-rubric.md` (read `show_rule` for
unfamiliar rules BEFORE classifying):

| Bucket | Interactive | Autonomous |
|---|---|---|
| MECHANICAL (single file, no semantic change) | Apply | Apply |
| STRUCTURAL (duplication across files, cognitive complexity, extract method/class, public API) | Plan → `question` approval → apply | **Escalate** |
| SECURITY (hotspots; anything tagged security/cwe/owasp; type VULNERABILITY/BUG touching auth/crypto/SQL/regex/concurrency) | Hotspots: `question` fix/safe/acknowledged; security issues: plan+approval | **Escalate** |
| SKIP | Record reason | Record reason |

A MECHANICAL member with hidden semantics promotes its ENTIRE cluster to
STRUCTURAL. Shallow mode downgrades STRUCTURAL clusters rooted in lines the PR
didn't touch to SKIP (`out-of-scope-shallow-mode`).

**8.5 Apply.** MECHANICAL: minimal edit per cluster, never bundle unrelated
changes. STRUCTURAL (interactive only): draft the plan — root cause, 2-3
strategies with trade-offs, recommendation, files in execution order, new code
surface, call sites, behavior preservation, risks/rollback — present it via
`question`, apply only on approval, SKIP with the user's reason on rejection.
Hotspots (interactive only): `show_security_hotspot`, then `question` with
fix / safe / acknowledged; `change_security_hotspot_status` needs the user's
justification verbatim — **never auto-decide, never mark SAFE without an
explicit user justification, in any mode**.

**8.6 Validate.** Detect test commands per
`{plugin-root}/jelou/references/sonar-test-detection.md`; record the baseline
BEFORE applying (a test failing before must not be expected to pass after).
Unit → integration order. On unit failure: attribute, revert the offending
cluster edit, re-run; unrelated pre-existing failures surface to the user
(interactive) or escalate (autonomous). No tests at all → note it loudly; do
not declare success.

**8.7 Re-scan & closure.** Prefer a local `sonar-scanner` when available;
otherwise `analyze_code_snippet` per modified file plus a re-query of the PR's
issues. Closure matrix: applied clusters' issues → 0; new issues → 0;
`duplicated_lines_density` and touched-file `cognitive_complexity`
non-increasing; quality gate not worse than baseline. Reconcile bounded to
**2 iterations**: still-open applied cluster → re-enter 8.4 for it; new issues
→ new cluster; after 2, interactive escalates to the user with the diff,
autonomous records the escalation (`sonar-closure-incomplete`). Quality gate
regressed → REVERT the applied cluster edits (`git checkout -- <files>` per
recorded cluster — 8.5 records each cluster's file list for exactly this) so
Step 10's commit cannot carry the regression, then report the reverted
clusters as escalated.

**8.8 Sonar hard rules (both modes):** never disable a rule to silence an
issue (SKIP with reason instead); never edit tests to pass unless the test
itself was the finding and the user approved; never declare the phase done on
Step 8.6 alone — 8.7 must verify closure.

## Step 9 — Lint & format modified files

Only files changed during this run (`git diff --name-only HEAD`), never the
whole repo. Formatter first, then linter with `--fix`, filtered by file type:
Biome (`biome.json`), Prettier (`.prettierrc*`), ESLint (`.eslintrc*` /
`eslint.config.*`), Ruff/Black/isort (`pyproject.toml`), gofmt+goimports
(`go.mod`), rustfmt (`Cargo.toml`), RuboCop (`.rubocop.yml`), or
`pre-commit run --files $MODIFIED` when `.pre-commit-config.yaml` exists.
Unfixable errors: interactive surfaces them — do not commit broken state;
autonomous escalates (`lint-unfixable`).

## Step 10 — Commit & push (guarded)

After all threads, CI fixes, and the Sonar phase — stage ONLY the files this
run modified (track them as you edit), never `git add -A`: the Sonar phase
may leave `.scannerwork/` at the repo root and test/lint runs emit coverage
and cache directories, and sweeping those into an unattended commit pollutes
the PR diff and re-triggers review bots, burning the cycle budget:

```bash
git add <files-modified-this-run>
git commit -m "chore: address PR review comments"
```

Subject variants: only CI fixes → `chore: fix failing CI checks`; only Sonar
fixes → `refactor: address sonar findings on PR #<n>`; only the Step 3 merge
commit → skip the commit, just push. Match the repo's commit language from
`git log -10 --pretty=%s`.

**Push guard — mandatory before EVERY push, both modes:**

```bash
node {plugin-root}/bin/head-sha-guard.mjs \
  --remote origin --branch "$BRANCH" --expected "$LAST_SEEN_SHA"
```

The guard prints one JSON object to stdout (`{"status": ..., ...}`) and its
exit code is the contract. **Fail closed**: empty stdout, unparseable JSON, or
any exit code other than 0 means DO NOT PUSH.

- exit 0 (`ok`) → `git push`, then refresh
  `LAST_SEEN_SHA=$(git rev-parse "origin/$BRANCH")`.
- exit 3 (`moved`) → the branch advanced outside this loop (a human pushed).
  Interactive: warn, merge `origin/$BRANCH` into the local branch (Step 3
  procedure), refresh `LAST_SEEN_SHA=$(git rev-parse "origin/$BRANCH")` —
  without this refresh the re-run compares against the stale SHA and loops
  forever — then re-run the guard ONCE; if it reports `moved` again the
  branch is actively moving: stop and report. Autonomous: escalate
  (`branch-moved-externally`) and stop this PR. **Never force-push, in any
  mode.**
- exit 2 (`error`) → report the JSON `message` from stdout and stop this PR.
- anything else (empty stdout, crash) → treat as `error`; never push.

If multiple PRs share the branch, one push covers them.

### 10.5 — Flush the reply/resolution queue

Immediately after a successful push: post every queued reply and resolve
every queued thread (Step 6.5 mechanics). The code the replies claim is now
on the PR, so GitHub state and PR content agree. If the push was blocked
(guard `moved`/`error`, fork), the queue is NOT flushed — report the queued
threads as pending with their compose text so a resumed run (threads still
unresolved on GitHub) picks them up again.

## Step 11 — Watch the re-triggered checks (bounded)

Skip if Step 7 found no checks and Step 8 didn't run. Otherwise:

```bash
timeout 600 gh pr checks "$PR_NUMBER" --watch --interval 30
```

**Cycle budget: at most 2 fix→push→watch cycles per PR** (Sonar's 8.7
reconciliation shares this budget — it never adds cycles).

- Still red, auto-fixable per 7.4, budget remains → re-enter Step 7.3 for one
  more pass. In autonomous mode, re-enter at **Step 4** instead (review bots
  re-review every push; threads must be re-fetched — the handled-ids set
  prevents double-fixing).
- Still red otherwise → stop; list the red jobs with URLs (interactive) or
  escalate each (`ci-red-after-budget`) (autonomous).
- Timeout with jobs still running → report them; do not keep blocking.
- A same-signature failure (same job + same normalized error as a previous
  cycle) → do not retry; interactive reports, autonomous escalates
  (`thrash-detected`).

**Done-gate (autonomous).** A PR is green ONLY when BOTH hold:

1. Checks registered (`checks.length > 0` — an empty set is NOT green; keep
   polling within the watch budget) and every check is terminal in
   {success, neutral, skipped}.
2. No unresolved actionable review threads remain. After the LAST green watch,
   wait `review_wait` once more and re-fetch threads (Step 5 query): review
   bots re-review the final push. New actionable threads + cycle budget
   remaining → run one more Step 6 round. Budget spent → report those threads
   as escalated/unresolved — the PR is NOT declared green.

Interactive mode reports the same two halves but lets the user decide when to
stop.

## Step 12 — Final summary

One block per PR, in the user's language:

```
PR #<num> — <title>
  Conflicts:                <none | resolved (N files) | aborted+escalated | unknown>
  Threads processed:        <total>  (auto-applied / refactors approved / escalated / no-action)
  Threads resolved on GH:   <count>/<total>
  CI red jobs:              <none | N found>  (auto-fixed / rerun / escalated)
  Sonar:                    <not-detected | skipped-no-tooling | N clusters: A mechanical, B structural, C hotspots, D skipped>
  Sonar quality gate:       <before> → <after>   (omit when not detected)
  Push:                     <OK (sha) | blocked-branch-moved | none-needed>
  Checks after push:        <green | red (list) | timeout | running>
  Done-gate:                <GREEN | NOT GREEN — <reason>>
  Escalations:              <count>  (each with its ESCALATION block and resume command)
```

## Hard rules

- Never rebase; never force-push; never push without the head-sha-guard.
- Never hand-edit lockfiles — regenerate.
- Conflicts before comments; single push per cycle; at most 2 cycles.
- Bots' comments are first-class; already-resolved/outdated threads are
  skipped silently; handled ids are never re-fixed across re-fetches.
- Autonomous ask-paths: skip/rerun/escalate only — never apply; conflict
  ask-paths `git merge --abort` before escalating; security comments and
  SECURITY Sonar clusters escalate.
- Never mark a Sonar hotspot SAFE/ACKNOWLEDGED without an explicit user
  justification; never disable a Sonar rule to silence an issue.
- Empty check set ≠ green; done requires both halves (checks AND threads).
- Flaky ≠ broken: rerun once, then treat as real.
- Fork PRs the local branch cannot push to: abort conflict resolution with a
  clear message; comment processing may proceed.
