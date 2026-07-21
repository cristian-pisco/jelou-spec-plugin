# Workflow: goal

Goal-driven production-like test orchestrator (formerly `production-like`). The user
supplies a **goal matrix** — a set of objectives, each at frontend, backend, or fullstack
level — and this workflow compiles each objective into E2E suites, boots the full local
stack once, and runs a **convergence loop** that only ends when every objective is green
(or a bounded iteration cap is exhausted). Frontend and fullstack objectives MUST carry
video evidence in the final report.

It classifies the run scope (fullstack vs full-backend), owns the dev-environment
lifecycle (boot once, teardown once via `jelou/references/env-lifecycle.md`), and
delegates test EXECUTION to runner subagents — it never runs a suite or authors a spec
inline:

- backend services → `jlu-test-suite-runner` (host unit+integration via `/jlu-test-suite`) + `jlu-backend-e2e-runner` (a Testcontainers backend-E2E phase, dependencies only, real HTTP)
- UI services      → `jlu-ui-qa-runner` (`/jlu-ui-qa-run --no-boot`, Playwright against the live stack); the orchestrator owns only the OTP auth gate before it

No seed system: reuses `dev` blocks + `data_isolation: per-run`. Testcontainers is permitted ONLY in the backend E2E path (`test/e2e/**`, `*.e2e-spec.ts`), dependencies-only, capped to `WORKERS` (see `subagent-base.md`).

## Inputs

- `ARG` — the goal matrix, inline (free text or JSON; see Phase 0). May also carry an
  optional `--task=<slug>` (task slug auto-detected from branch when omitted). Invoked
  with no matrix, the workflow resumes from a previously persisted `$TASK_DIR/GOALS.md`.
- Flags: `--force`, `--allow-shared-data`, `--allow-prod-target`, `--workers=N`,
  `--max-iterations=N` (convergence-loop cap, default `3`).

## Process

### Phase 0 — Goal matrix (parse, disambiguate, persist)

0a. **Parse the inline matrix.** Run
   `node <plugin-root>/bin/parse-goal-matrix.mjs '<ARG>'` →
   `{ objectives: [{ id, title, level, services, success_criteria, ambiguities }], flags }`.
   Each objective gets a stable id `G1..Gn`. `level` is one of
   `frontend | backend | fullstack | unknown`. Exit 1 (empty/invalid input) → if a
   persisted `$TASK_DIR/GOALS.md` exists, resume from it; otherwise surface the message
   and stop.

0b. **Disambiguate — interview, never guess.** For every objective whose parse left an
   ambiguity (`level: unknown`, empty `services`, or a `success_criteria` that is not
   falsifiable), ask via `question` (AskUserQuestion) before anything boots:
   - level unclear → "Is `<title>` a frontend, backend, or fullstack objective?"
   - service unmappable → offer the task's affected services as options.
   - success criterion vague → ask for the observable pass condition (what a test can assert).
   Never infer a level silently and never drop an ambiguous objective.

0c. **Persist the resolved matrix.** Write `$TASK_DIR/GOALS.md` (after Phase 1 resolves
   `TASK_DIR`; buffer until then): frontmatter (`task`, `created`, `max_iterations`) plus
   one section per objective — id, title, level, services, success criteria, and a
   `status` line (`pending` initially; the convergence loop updates it to `green`/`red`
   with the iteration count). GOALS.md is the single source of truth for the loop and for
   resume: a later `/jlu-goal` with no matrix argument re-reads it and re-enters the loop
   with only the non-green objectives.

   **The matrix governs the verdict; `SPEC.md` is CONTEXT** for compiling objective
   suites (step 7.5), never a second verdict source.

### Phase 1 — Resolve task, classify, gate

1. **Resolve slug** (identical to `ui-qa-run.md` Phase 1 step 1): from `--task=<slug>`,
   else from the branch (`production/*` | `staging/*`); refuse if undetectable.
2. **Locate the workspace** (`.spec-workspace/`); refuse if missing.
3. **Locate the task directory** via marker files (`TASKS.md` | `SPEC.md` | `PROPOSAL.md`);
   `TASK_DIR = dirname(<marker>)`; refuse if none. Flush the Phase 0 matrix to
   `$TASK_DIR/GOALS.md` now (or, when resuming, read the existing one).
4. **Acquire the per-task lock** `$TASK_DIR/.goal.lock` (flock, PID file,
   `trap` release on `EXIT INT TERM`).
5. **Read `affected_services`** from `TASKS.md` frontmatter (fallback: `## Services`
   headings). Refuse if empty: "no affected_services — goal needs a task."
6. **Build the service list.** For each affected service, read its `services.yaml` entry
   and collect `{ id, stack, description }`. Assemble a JSON array.
7. **Classify.** Run `node <plugin-root>/bin/classify-task-scope.mjs '<json>'` →
   `{ scope, ui_services, backend_services, warnings }`. Print any `warnings`. On exit 1
   (empty/invalid), surface the message and stop. Then reconcile with the matrix: a
   `frontend`/`fullstack` objective requires at least one service in `ui_services`; a
   `backend`/`fullstack` objective at least one in `backend_services`. A mismatch (e.g. a
   frontend objective on a task with no UI service) → refuse with the objective id and
   the classification.
7.5. **Materialize objective E2E artifacts (delegated, never inline).** Every objective
   must end up with tagged, runnable E2E suites BEFORE the loop starts. Derivation is
   **unconditional and silent**: never ask the user "how should I scope this run?", and
   never invent a "Phase-10 / deferred-manual / manual-E2E" gate — no such gate exists.

   **Objective→suite tagging contract.** Results must map back to objectives:
   - UI specs carry the goal tag in the test title — `test('… @goal:G<id>', …)` — so a
     run can be scoped with `--grep "@goal:G<id>"` and its results attributed.
   - Backend E2E suites carry the goal id in the `describe` title — `describe('[G<id>] …')`.

   For each **frontend or fullstack** objective, for each of its services in `ui_services`:
   resolve the active worktree (`jelou/references/worktree-resolution.md`) and check whether
   Playwright infra + `services/<UI_SERVICE_ID>/user-flow.md` + specs tagged `@goal:G<id>`
   already exist.
   - **Present →** no-op.
   - **Missing →** dispatch `jlu-ui-e2e-writer` **once** (`MODE=bootstrap` when no
     Playwright infra, else `MODE=derive-from-spec`; `EXPECT=live` — post-deploy: the
     writer skips its RED-verification run, the orchestrator runs the suite later) with
     the objective (id, title, success criteria) as the derivation target and
     `$TASK_DIR/SPEC.md` as CONTEXT, requiring the `@goal:G<id>` tag on every authored
     test title; then commit the generated `user-flow.md` + specs to the task directory
     and re-read.

   For each **backend or fullstack** objective, for each of its services in
   `backend_services`: check whether the service's E2E globs (step 11b.1) match suites
   tagged `[G<id>]`. Missing → dispatch `jlu-test-writer` (`--allow-test-edits`, E2E
   target = the declared convention, default `test/e2e/**`, dependencies-only, per
   `jelou/references/backend-e2e-authoring.md` — assert DB-persistence + cache side
   effects, not just the 2xx) with the objective as target and `SPEC.md` as context,
   requiring the `[G<id>]` describe tag.

   After this step every UI service has a `user-flow.md`, so step 8 can compute the
   fullstack boot order, and every objective's suite pre-exists for the loop.

8. **Compute the Service Boot Order.**
   - `full-backend`: the affected `backend_services` (each must end up with a `dev` block —
     step 8b resolves any that are missing).
   - `fullstack`: the union of (a) each UI service's `user-flow.md` `Service Boot Order`
     (resolved as in `ui-qa-run.md` Phase 1 step 7) and (b) affected backend services.
     Reconcile boot-order conflicts with `ui-qa-run`'s rule (refuse on contradiction).

8a. **Expand the boot order with runtime dependencies (`depends_on`).** A UI service that
   authenticates against a backend depends, at request time, on services that are NOT in
   `affected_services` and may not appear in its `user-flow.md` `Service Boot Order` — its
   login backend and that backend's session-validation API. If those are not booted, the live
   flow returns `401` even though the service-under-test is healthy (this was the datum-legacy
   run's gateway-401 root cause: the login + session-validation backends were never started).
   So for every service now in the boot order, read its optional `depends_on` list from
   `services.yaml` (`jelou/references/dev-block-schema.md`) and fold each entry into the boot
   order **transitively** (a dependency's own `depends_on` is included too); de-duplicate and
   order each dependency before the service that needs it. Each folded dependency must end up
   with a `dev` block — step 8b applies to them exactly as to any other boot-order service. A
   UI service MUST declare its login backend and session-validation API in `depends_on`.

8b. **Resolve missing `dev` blocks — auto-derive + persist, NEVER improvise.** For each
   service in the boot order whose `services.yaml` entry has **no `dev` block**, do NOT skip
   it and do NOT guess a launcher/command (improvising `docker exec yarn dev` on an npm
   project is the failure this step exists to prevent):

   1. Resolve the service's active worktree (`jelou/references/worktree-resolution.md`).
   2. Derive a candidate block:
      `node <plugin-root>/bin/derive-dev-block.mjs <worktree> --stack <services.yaml stack>`.
      The script detects the package manager from the lockfile and the dev script from
      `package.json`, and emits one of three blocks (or exits `3` with a `reason` when it cannot
      infer one): the idle-dev-container pattern (`Dockerfile.dev` → `CMD sleep infinity`) →
      `launcher: docker-exec`; a compose file with no idle marker (the container runs the app
      itself) → `launcher: docker`; a host dev server → `launcher: npm|shell`.
   3. **Exit 3 (not derivable):** refuse the whole run — do NOT improvise. Print the `reason`
      and: "Add a `dev` block under `<service>` in `.spec-workspace/registry/services.yaml`
      (see `jelou/references/dev-block-schema.md` for the schema, incl. the `docker-exec`
      launcher), then re-run." (Do NOT point at `/jlu-register-service` — that writes
      `jlu-services.json` for `start-dev`, a different registry; goal reads the
      `dev` block from `services.yaml`.)
   4. **Derivable:** show the rendered `dev:` YAML (the script's `yaml` field) plus any
      `warnings`, then `AskUserQuestion`. **The option set depends on the service type** so a
      UI service can never be silently dropped:
      > "`<service>` has no `dev` block. I inferred this block (launcher `<launcher>`, command
      > `<command>`). Shall I write it to `.spec-workspace/registry/services.yaml`?"
      - **Backend service** (`<service> ∉ ui_services`): options **Write and continue** ·
        **I'll edit it myself (abort)** · **Skip this service**.
      - **UI service** (`<service> ∈ ui_services`, known from the classify step): options
        **Write and continue** · **I'll edit it myself (abort)** only — no "Skip"; the prompt
        states skipping a UI service is not permitted (E2E is mandatory for frontend changes,
        per `ui-qa-run.md` step 6).

      Outcomes:
      - **Write and continue** → write the block under that service's entry in
        `.spec-workspace/registry/services.yaml`, re-read the registry, continue.
      - **I'll edit it myself** → refuse with the step 8b.3 message (edit `services.yaml`); do NOT
        improvise.
      - **Skip this service** (backend only) → drop it from the boot order with a one-line
        note; its `test-suite` still runs and surfaces its own "infra unreachable" hint.
   5. After this step every service remaining in the boot order has a `dev` block. The boot
      contract (`env-lifecycle.md`) refuses to boot anything without one.

9. **Pre-flight gate.** Run `preflight_gate` per `jelou/references/env-lifecycle.md` over
   the boot-order services, with `WORKERS=${WORKERS:-1}` and
   `BROWSER_OVERHEAD_MB=$([ "$scope" = fullstack ] && echo 1300 || echo 0)`. Honor
   `--force` / `--allow-shared-data`.

### Phase 2.0 — Task-isolated plan for eligible worktree backends

Before the boot loop, decide which boot-order services boot **task-isolated** (a fresh namespaced
`<svc>-<slug>` container from worktree code + cross-service `wireEnv`) versus the unchanged
reuse-or-reboot below. A service is eligible only if it is `docker-exec` AND has a worktree for this
slug AND is present in the unified registry (`readUnifiedRegistry` — the sole source of the
`ports`/`peers`/`network` fields the override needs). Partition the boot order:

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/boot-engine/task-isolated-eligibility.mjs'),
  import('{plugin-root}/bin/lib/registry/read.mjs')
]).then(([{ partitionBootOrder }, { readUnifiedRegistry }]) => {
  const services = JSON.parse(process.argv[1]);
  const worktreePaths = JSON.parse(process.argv[2]);
  let ids = new Set();
  try { ids = new Set(readUnifiedRegistry(process.argv[3]).services.map((s) => s.id)); } catch (e) {}
  process.stdout.write(JSON.stringify(partitionBootOrder({ services, worktreePaths, unifiedRegistryIds: ids })));
});
" '{bootOrderServicesJson}' '{worktreePathsJson}' "{root}"
```

`{bootOrderServicesJson}` is the boot-order services as `[{ id, dev: { launcher } }]`; `{worktreePathsJson}`
maps each service id with a resolved worktree to its path. For each id in `warnWorktreeNotIsolated`,
print: `⚠ <svc>: has a worktree but is not in the unified registry — booting main code (worktree not
isolated this run).`

If `eligible` is empty, skip the rest of this subsection — there is no plan; Phase 2 boots exactly as
before. Otherwise build the plan for the eligible set (passing ONLY the eligible ids as
`worktreePaths`, so `buildBootPlan` marks exactly them `task-isolated` and everyone else `shared-reuse`
with a `wiredEnv` iff they peer an eligible service):

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/build-boot-plan.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/ports.mjs')
]).then(([{ buildPlanForWorkspace }, { parseOccupiedPorts }]) => {
  const { spawnSync } = require('node:child_process');
  const ps = spawnSync('docker', ['ps', '--format', '{{.Ports}}'], { encoding: 'utf8' });
  const occupied = [...parseOccupiedPorts(ps.stdout || '')];
  const eligibleWorktrees = JSON.parse(process.argv[2]);
  const plan = buildPlanForWorkspace({ workspaceRoot: process.argv[1], slug: process.argv[3], worktreePaths: eligibleWorktrees, occupied });
  process.stdout.write(JSON.stringify(plan));
});
" "{root}" '{eligibleWorktreePathsJson}' "{slug}"
```

Capture this as `{planJson}`. `{eligibleWorktreePathsJson}` is `{ <id>: <worktreePath> }` for the
`eligible` ids only. Each plan entry is either `policy: 'task-isolated'` (an eligible service) or
`policy: 'shared-reuse'` (another unified-registry backend, carrying a non-null `wiredEnv` only when it
peers an eligible service).

If any eligible service booted task-isolated AND `ui_services` is non-empty, ALSO print (once):
`⚠ UI E2E will hit the MAIN host port of task-isolated backend(s) <eligible ids> — frontend→
namespaced-backend wiring is not yet supported (this covers backend↔backend only).`

### Phase 2 — Boot once

10. **Boot the Service Boot Order with a per-service reuse-or-reboot decision.** Run
    `boot(Service Boot Order)` per `jelou/references/env-lifecycle.md`, logging to
    `$TASK_DIR/.goal/launch-<service>.log`.
    **Per-service plan branch (from Phase 2.0).** Before the reuse-or-reboot decision below, check
    the service's entry in `{planJson}` (match by `id`):
    - **Task-isolated entry** (`policy: 'task-isolated'`): boot it via the `## Plan-driven boot`
      **task-isolated** steps in `jelou/references/env-lifecycle.md` — write every `planEntryToCommands(entry).files[]` entry verbatim to `<entry.cwd>` (the `docker-compose.jlu.yml` override and, when `wiredEnv` is present, the de-obfuscated `.env`);
      `docker compose -p <entry.projectName> -f <entry.composeFile> -f docker-compose.jlu.yml up -d`;
      `docker exec -d <entry.projectName> sh -lc "cd /app && <entry.command> > /tmp/<entry.projectName>.dev.log 2>&1"`;
      wait readiness on the allocated host port (`entry.readiness.port`); register
      `BOOTED+=(<service>)` and `TEARDOWN_CMD[<service>]="docker compose -p <entry.projectName> down"`.
      WARN if `entry.imageResolved` is false. Then SKIP the reuse-or-reboot decision below for this
      service (it is fully booted).
    - **Shared-reuse entry with a non-null `entry.wiredEnv`** (a main-branch backend peering an
      eligible one): back up `<entry.cwd>/.env` first (`bin/lib/dev-orchestrator/stack/backend-env-backup.mjs`,
      recorded so teardown restores it), write the `.env` from `planEntryToCommands(entry).files` (de-obfuscated), THEN fall through
      to the reuse-or-reboot decision below (unchanged) so it picks up the rewritten peer URL.
    - **No plan entry, or a plan entry with a null `wiredEnv`**: fall through to the reuse-or-reboot
      decision below, unchanged.

    For each service in the order, the FIRST
    action — **before launching it** — is the readiness probe from
    `jelou/references/env-lifecycle.md` (`http_200`/`port_open` on the mapped host port), and the
    probe decides whether the boot step launches it at all:
    - **Healthy** → reuse the already-running process; do NOT add it to `BOOTED[]`, so teardown
      never stops it (it belongs to the developer). **Two exceptions force a fresh reboot:**
      - *Stale `env_files`* (npm/make/shell launchers): reuse only if no `env_file` is newer than
        the running process (compare each `env_file` mtime against the process start time,
        `ps -o lstart= -p <pid>`).
      - *A frontend service* (`<service> ∈ ui_services`): **never reuse — always reboot fresh**,
        even when healthy and even when no `env_file` looks newer. A frontend **bakes** its config
        (API base URLs, the Turnstile flag) into the served bundle at dev-server start, and the
        mtime check cannot detect a developer's own `yarn dev` started without the `.env.e2e`
        overlay — it is "newer" than every file yet baked the app's `.env` (production URLs + real
        Turnstile). Reusing it runs the suite against a prod-pointing bundle whose login v2 POSTs
        to prod and is rejected (HTTP 422 / Turnstile) — the datum-legacy failure, where the reused
        Vite served prod even though `.env.e2e` was correct on disk. Stop the healthy process, boot
        fresh (next bullet sources `.env.e2e` via `set -a`), and register it in `BOOTED[]`. See
        `env-lifecycle.md` boot().
    - **Unhealthy, absent, or stale** → boot it fresh with `data_isolation: per-run` and register
      it in `BOOTED[]`/`TEARDOWN_CMD[]` so teardown reclaims it. This makes the run reproducible
      when no live stack exists, and frugal when one does.

    On `ready_timeout` → `STATUS: BLOCKED` (teardown still runs via the trap).

### Phase 3 — Backend execution (delegated)

11. For each service in `backend_services`: dispatch `jlu-test-suite-runner` with
    `<SERVICE_ID>`, its resolved worktree, `<TASK_DIR>`, `<PLUGIN_ROOT>`, `<WORKERS>`.
    Parse its `STATUS:` line; record PASS/FAIL + grouped failures + `breadth` gaps.
    Do NOT abort the run on failure. This unit+integration pass runs ONCE (a stack-health
    baseline); it is not re-run per loop iteration. If the convergence loop (Phase 4.6)
    later applied any backend product fix, re-dispatch `jlu-test-suite-runner` once for
    the fixed service(s) after the loop exits, so the final report reflects post-fix
    reality.

### Phase 3.5 — Backend E2E (delegated; mandatory, never bypassable)

The backend real-dependencies-over-HTTP gate is **mandatory** for every backend service —
integration/E2E coverage is indispensable and NO subagent (the orchestrator included) may
skip it, report it as `N/A` / "not applicable" / "skipped", or credit the Phase 3
integration run as if it were this phase. The orchestrator MUST dispatch the runner; it
MUST NOT substitute its own `find`/glob check to short-circuit the dispatch, and MUST NOT
decide on its own that "integration already covers it". The only sanctioned way for a repo
whose real-DB HTTP tier uses a non-default convention (e.g. `*.integration-spec.ts`) to
satisfy this phase is by declaring its suite glob in `services.yaml` (`e2e.globs`, step
11b.1) — which the runner then actually RUNS. Recognition is by that declared glob, never by
orchestrator narrative.

11b. For each service in `backend_services`, serially (concurrency = `WORKERS`):

   1. **Resolve the E2E discovery glob(s).** Read the service's `e2e.globs` from
      `services.yaml` (`jelou/templates/services-yaml.md`); default
      `["test/e2e/**/*.e2e-spec.ts"]` when absent. Pass them to the runner as `E2E_GLOBS`.
   2. **Dispatch `jlu-backend-e2e-runner`** (it runs the matched suites with Testcontainers
      dependencies only, real HTTP). Parse its `STATUS:` line, and attribute per-objective
      results by the `[G<id>]` describe tags (step 7.5): an objective's backend side is
      green iff every `[G<id>]`-tagged test passed.
   3. **`PASS` / `FAIL`** → record it; never abort the run (the convergence loop owns the retry).
   4. **`NO_E2E_SUITE`** → authoring is **MANDATORY, not discretionary**: route to
      `jlu-test-writer` (`--allow-test-edits`, E2E target = the declared convention, default
      `test/e2e/**`, dependencies-only, following the assertion doctrine in
      `jelou/references/backend-e2e-authoring.md` — assert DB-persistence + cache side
      effects, not just the 2xx), then re-dispatch the runner **once**. The orchestrator may
      NOT skip authoring on the grounds that another tier "already covers it": if that tier
      is the real E2E surface it is declared via `e2e.globs` (step 11b.1) and the runner runs
      it — otherwise the suite is authored here.
   5. **Still `NO_E2E_SUITE` after re-dispatch** (or a `NEEDS_CONTEXT` that cannot be
      resolved) → the service's backend E2E is **UNSATISFIED**. Record it as such; per step
      14 it forces the overall verdict to NOT be `PASS` — never silently pass.

   Normally the suite already exists, authored shift-left at `/jlu-execute-task` Step 8f (or
   found via `e2e.globs`); the reactive authoring in 11b.4 is the fallback when a task was
   shipped before that step ran.

### Phase 3.75 — Auth gate (orchestrator-owned)

11c. For each UI service, perform the auth gate inline per `ui-qa-run.md` steps
    14b/14c: probe the session and, when invalid, mint a fresh one. For a **loopback
    `E2E_BASE_URL`** the gate self-heals **deterministically** — `bin/e2e-ensure-account.mjs`
    (guarantee the account) then `bin/e2e-login-local.mjs` (a direct API login: no browser,
    no Turnstile, no OTP), and — only when that minted cookie is valid yet the gateway still
    401s because the native login left `logsM.userSessions` unpopulated — `bin/e2e-session-sync.mjs`
    inline on that same locally-minted cookie, then a re-probe. The Gmail/OTP driver is
    reserved for genuinely remote/prod targets. Otherwise (a remote target) log in via OTP
    (Gmail read / paste fallback) and provision the local cookie-guard session. This produces a
    valid `storageState` the UI runner consumes. The OTP gate stays in the orchestrator because
    the Gmail MCP is session-bound; it is the ONLY execution the orchestrator performs.

    **No discretionary auth-gate menu — auto-refresh, never "your call".** An invalid or
    stale session is NEVER the user's decision to make. The orchestrator MUST run the local
    OTP login driver (`bin/e2e-login.mjs`) automatically and regenerate the `storageState`;
    it MUST NOT surface an `AskUserQuestion` offering to "accept the stale session / pause for
    a manual refresh / choose whether to refresh" — presenting that choice is the exact defect
    this guard forbids. `E2E_BASE_URL` and `TEST_EMAIL`/`TEST_PASSWORD` are known because the
    14b auth drivers self-load `.env.e2e` from `UI_WORKTREE`; never claim the target is unknown and never punt the refresh
    to the user. The ONLY user prompts the gate may raise are the four already in `ui-qa-run.md`
    step 14b: missing `e2e-auth.yaml` (one-time OTP sender/subject), the Gmail paste fallback,
    login-form-not-found (exit 44), and a genuinely remote captcha capture (exit 47). A green
    Success Criterion that fails live only because the session is stale is closed by refreshing
    the session, not by asking the user to accept the gap.

### Phase 4 — UI execution (delegated; frontend/fullstack objectives)

12. For each service in `ui_services`: dispatch `jlu-ui-qa-runner` (session already
    provisioned in 11c) with `--no-boot` semantics. Parse its `STATUS:`; on
    `NEEDS_CONTEXT`, broker via `AskUserQuestion` and re-dispatch with `USER_FEEDBACK`;
    on `ui_breadth_gaps`, route to `jlu-ui-e2e-writer` and re-dispatch once. Record
    PASS/FAIL, and attribute per-objective results by the `@goal:G<id>` title tags
    (step 7.5): an objective's UI side is green iff every `@goal:G<id>`-tagged test
    passed. Video recording is on for every run via the `JLU_E2E_VIDEO` contract the
    runner already exports (`references/playwright-conventions.md`) — the loop and the
    report consume those artifacts as evidence.

### Phase 4.25 — Goal convergence loop (run → fix → re-run until green or cap)

After the first execution pass (Phases 3.5 + 4), compute each objective's status from the
tagged results:

- `frontend` objective → green iff its `@goal:G<id>` UI tests all passed.
- `backend` objective → green iff its `[G<id>]` backend-E2E tests all passed.
- `fullstack` objective → green iff BOTH sides passed.

Update every objective's `status` line in `$TASK_DIR/GOALS.md` (`green` / `red`, with the
iteration number). Then loop:

```
iteration = 1
while (any objective is red) and (iteration < MAX_ITERATIONS):   # default 3, --max-iterations=N
  for each red objective G<id>:
    - backend side red → dispatch jlu-implementer with the failing runner output, the
      objective (title + success criteria), SPEC.md as context, and the service worktree:
      fix PRODUCT code (or the test, only when the evidence shows the test itself is
      wrong) — never weaken an assertion to force green. Then re-dispatch
      jlu-backend-e2e-runner scoped to the objective's globs/tag.
    - UI side red → re-dispatch jlu-ui-qa-runner scoped `--grep "@goal:G<id>"` (its
      internal jlu-ui-fix-loop gets a fresh bounded budget each outer iteration);
      broker NEEDS_CONTEXT via AskUserQuestion exactly as in Phase 4.
  recompute statuses from the tagged results; update GOALS.md; iteration += 1
```

Loop exit:
- **All green → CONVERGED.** If any fix agent modified files, dispatch `jlu-git-agent`
  once to commit them on the task branch
  (`goal: converge <red-ids> in <iteration> iteration(s)`), and honor Phase 3's post-fix
  unit+integration re-run for the touched backend services.
- **Cap exhausted with reds → NOT-CONVERGED.** Record each surviving red objective with
  its last failure evidence (failing test titles, runner output, trace/video paths).
  Never loop past `MAX_ITERATIONS`; never downgrade a red to green without a passing
  re-run. The orchestrator never fixes anything inline — every fix is delegated
  (`jlu-implementer` / the runner's `jlu-ui-fix-loop`).

### Phase 4.4 — Video evidence (mandatory for frontend/fullstack objectives)

12a. For every `frontend` and `fullstack` objective, collect the video artifact(s) of its
    `@goal:G<id>` tests from the Playwright output directory (`test-results/**/*.webm` —
    pass AND fail; the `JLU_E2E_VIDEO` contract records both). Map each objective to its
    video path(s) for the final report.
    - A green frontend/fullstack objective with NO video artifact while `JLU_E2E_VIDEO`
      was non-`off` is **NOT reportable as green**: the consumer `playwright.config.ts`
      is not reading `process.env.JLU_E2E_VIDEO` (see
      `references/playwright-conventions.md`) — surface that config gap, apply the
      one-line `use.video` read via `jlu-ui-fix-loop`, and re-run the objective's suite
      once to produce the evidence. Video evidence is part of the objective's definition
      of done.
    - Backend-only objectives require no video.

### Phase 4.5 — Coverage-breadth + realistic-payload gate (refuse the false green)

A suite can be all-green and still production-thin — a one-happy-path test per requirement (a
filter with `columns: []`, a 1-text-column E2E) exits 0 yet never sends the production payload that
400s. This gate runs ONLY after the convergence loop reported every objective green; it never
re-classifies a suite that already FAILED. The orchestrator **consumes the runners' `breadth_gaps` /
`ui_breadth_gaps` and routes them to `jlu-test-writer` / `jlu-ui-e2e-writer`; the orchestrator never
probes or authors inline.** The data stack is already up and isolated `data_isolation: per-run` (see
the top of this file), so the runners' live probes are safe to mutate.

12b. **Static breadth audit (runner-fed).** `jlu-test-suite-runner` already ran
    `node <plugin-root>/bin/probe-coverage-breadth.mjs --service <worktree> --spec $TASK_DIR/SPEC.md --json`
    for its service and returned the result on its `STATUS:` line. The orchestrator only reads those
    returned `breadth` fields — it does NOT run the probe itself. The audit parses the touched
    DTO/validator surface (files matching `*.dto.*`/`*.schema.*` or carrying
    `@IsNumber`/`@IsUUID`/`@IsString`/`@IsArray`/`@IsBoolean`/`@IsNotEmpty`/`@ValidateNested`
    decorators) against the authored cases (`*.spec.*`/`*.test.*`) and emits
    `{ verdict, uncovered_dimensions, dto_fields_without_rejection, collections_only_empty, cross_field_refs_unpopulated }`,
    flagging `verdict: thin` (a validated DTO field — request body or typed query parameter —
    has no rejecting-payload test, or a collection/reference field is only ever exercised empty).

12c. **Live realistic-payload probe (runner-owned, never the orchestrator).** The runners — not the
    orchestrator — perform the live reconnaissance against the booted `per-run` stack: for each gap the
    audit names they send one **rejecting** payload per uncovered validator (a string into `@IsNumber`, a
    GUID into a numeric id, an empty collection where one is required) and record the 4xx — a 4xx the
    green suite never asserted is a CONFIRMED breadth gap (the exact GUID-string-into-`@IsNumber()`-field →
    400 shape); plus one **realistic success** payload that populates every cross-field reference (a
    filter naming a real column id, collections non-empty) and record the 2xx — an UNCOVERED-SUCCESS gap
    when no authored case sends it. Mutating success probes run ONLY against the isolated `per-run` dev
    data this run booted; never against a shared or prod target (honor `--allow-prod-target` /
    `--allow-shared-data` exactly as the boot gate does). The orchestrator consumes the resulting gap
    list; it never probes, edits files, or persists tests.

12d. **Verdict downgrade (advisory, never a hard fail).** If the audit verdict is `thin` OR the live
    probe confirmed any gap, the overall verdict is NOT `PASS`: emit `PASS-THIN / NEEDS-BREADTH` and, in
    the report, list every uncovered input dimension with the field name, the validator that rejects it,
    and (for confirmed gaps) the live 4xx/2xx the suite missed. A green-but-thin run is reported as
    explicitly NOT a clean pass. `PASS-THIN` does not block the pipeline — it routes the gap and self-heals.

12e. **Route the gap to the authors (detect, do not duplicate).** On `PASS-THIN`, re-dispatch the
    upstream authors to fill the named cases — **never author them here**: backend gaps → `jlu-test-writer`
    with `--allow-test-edits`, the `uncovered_dimensions` list, and — for gaps on the E2E path
    (`test/e2e/**`) — the `jelou/references/backend-e2e-authoring.md` doctrine (DB-persistence + cache
    side effects); UI gaps → `jlu-ui-e2e-writer`
    (`MODE=derive-from-spec`, `--allow-test-edits`) with the uncovered field-type/reference dimensions.
    After they author, re-run the affected suite once (the Phase 3/4 command) to confirm the new cases go
    RED-then-GREEN. goal remains a runner: it delegates EXECUTION and now also delegates the
    AUTHORING of the missing cases — it never writes a test file itself.

### Phase 5 — Teardown + report

13. Run `teardown(booted)` per `jelou/references/env-lifecycle.md`. This is the trap action
    registered at boot and runs on every exit path (success, failure, abort).
14. **Aggregate report.** Print:
    - **The goal matrix table** — one row per objective: id, title, level, final status
      (green/red), iterations consumed, and evidence (video path(s) for frontend/fullstack
      objectives — mandatory; failing test titles + trace paths for reds).
    - `scope`, services booted, a backend section (per-service PASS/FAIL with
      `test-suite`'s grouped failures, plus the Testcontainers backend-E2E PASS/FAIL), and
      a UI section (per-service PASS/FAIL).
    - The overall verdict. **`PASS` is granted ONLY when EVERY objective in the matrix is
      green (each via an actual runner `PASS` on its tagged tests), every frontend/fullstack
      objective carries its video evidence, AND every backend service ended in an actual
      backend-E2E runner `PASS` AND every UI service ended in an actual UI-E2E runner
      `PASS` — a missing, skipped, or `N/A` E2E phase is NEVER a `PASS`.** The verdicts:
    - `PASS` — the convergence loop CONVERGED: 100% of the matrix green, video evidence
      present for every frontend/fullstack objective, unit+integration, backend E2E, and
      UI E2E each actually ran and passed, AND the Phase 4.5 breadth gate is clean.
    - `PASS-THIN / NEEDS-BREADTH` — matrix fully green but the breadth gate found uncovered
      validator/reference dimensions (names them and the re-dispatch outcome; advisory, self-heals).
    - `FAIL / NOT-CONVERGED` — the iteration cap exhausted with red objectives (each listed
      with its last evidence), OR any suite failed outside the matrix, OR any backend/UI
      service's E2E phase is **UNSATISFIED** (a `NO_E2E_SUITE` that authoring could not
      resolve, or a runner that never produced a `PASS`/`FAIL`), OR a frontend/fullstack
      objective is missing its mandatory video evidence after the 12a re-run. There is no
      verdict path where a bypassed E2E — or a red objective — yields `PASS`.
    - `BLOCKED` — could not boot / pre-flight refused.
    Persist the final per-objective statuses to `$TASK_DIR/GOALS.md` so a later resume
    re-enters the loop with only the reds.

## Failure modes & UX

- No workspace / no task marker / empty `affected_services` → refuse with a clear message
  (needs a task created by `/jlu-new-task`).
- No matrix argument AND no persisted `$TASK_DIR/GOALS.md` → refuse: "goal needs a goal
  matrix — pass the objectives inline (see /jlu-goal) or re-run in a task that already has
  a GOALS.md."
- An ambiguous objective (unknown level / unmappable service / unfalsifiable criterion) →
  Phase 0b interviews the user; never guess, never silently drop it.
- Pre-flight gate failure → exit per the env-lifecycle contract; `--force` /
  `--allow-shared-data` override exactly as in `ui-qa-run`.
- Service in the boot order with no `dev` block → step 8b derives one and asks to persist it to
  `services.yaml`; **never improvise a boot command.** Not derivable / user declines → refuse and
  tell the user to add the `dev` block to `.spec-workspace/registry/services.yaml` (NOT
  `/jlu-register-service`, which writes the separate `jlu-services.json`). A UI service without a
  `dev` block is always a hard refuse — it is never offered "Omitir".
- `ready_timeout` on boot → `BLOCKED`; teardown runs.
- A delegated `test-suite` / `ui-qa-run` failure → recorded; the convergence loop owns the
  retry; a red that survives the cap → overall `FAIL / NOT-CONVERGED`, teardown runs.
- **The convergence loop is bounded and honest.** It NEVER exceeds `MAX_ITERATIONS`, never
  marks an objective green without a passing re-run of its tagged tests, and never lets a
  fix agent weaken an assertion to force green (a test edit is legitimate only when the
  evidence shows the test itself is wrong).
- Lock contention → another `goal` run is active on this task; refuse.
- **The orchestrator never executes tests and never authors specs.** All execution
  is delegated to `jlu-test-suite-runner` / `jlu-backend-e2e-runner` /
  `jlu-ui-qa-runner`; all authoring to `jlu-ui-e2e-writer` / `jlu-test-writer`; all
  fixing to `jlu-implementer` / the runner's `jlu-ui-fix-loop`. The
  orchestrator MUST NOT write any `.spec.ts` itself — inline `prodlike-*.spec.ts`
  probe specs are forbidden. Its only execution is the OTP auth gate (Phase 3.75).
- **The backend E2E phase is mandatory and non-bypassable.** The orchestrator MUST dispatch
  `jlu-backend-e2e-runner` for every backend service; it MUST NOT short-circuit with its own
  file search, report the phase as `N/A` / `skipped` / `not applicable`, or credit the Phase
  3 integration run as the E2E phase. `NO_E2E_SUITE` triggers **mandatory** authoring
  (`jlu-test-writer`) plus one re-dispatch — declining to author "because integration covers
  it" is the exact bypass this rule forbids. An E2E phase that never produced a runner `PASS`
  is `UNSATISFIED` and makes the overall verdict `FAIL`, never `PASS`. A repo whose real-DB
  HTTP tier uses a non-default convention (`*.integration-spec.ts`) declares it in
  `services.yaml` `e2e.globs` so the runner actually runs it — recognition is by the declared
  glob, never by narrative.
- **Suite derivation is unconditional and silent.** Never ask "how should I scope this run?"
  and never fabricate a "Phase-10 / deferred-manual / manual-E2E wall" — it does not
  exist. A missing suite is materialized in step 7.5 by `jlu-ui-e2e-writer` /
  `jlu-test-writer` against the objective, with `SPEC.md` as context.
- All suites green but the Phase 4.5 breadth gate finds a validated DTO field with no rejecting-payload
  test, an only-empty collection, or an unpopulated cross-field reference → verdict `PASS-THIN /
  NEEDS-BREADTH`: it names the dimensions, re-dispatches `jlu-test-writer` / `jlu-ui-e2e-writer`
  (`--allow-test-edits`) to author them, and re-runs the affected suite. goal never authors
  the cases itself (detect and route).

## See also

- `jelou/references/env-lifecycle.md` — the lifecycle contract this workflow owns.
- `jelou/workflows/test-suite.md`, `jelou/workflows/ui-qa-run.md` — the delegated skills.
- `bin/parse-goal-matrix.mjs` — the Phase 0 goal-matrix parser.
- `bin/classify-task-scope.mjs` — the scope classifier.
- `bin/probe-coverage-breadth.mjs` — the Phase 4.5 static breadth audit (validator-rejection + realistic-payload coverage).
- `bin/derive-dev-block.mjs` — infers a `dev` block (package-manager-detected) for a service
  that has none, so step 8b can boot it deterministically instead of improvising.
- `jelou/references/dev-block-schema.md`, `jelou/templates/services-yaml.md` — `dev` block
  (incl. the `docker-exec` launcher for idle dev containers).
- `jelou/references/playwright-conventions.md` — the `JLU_E2E_VIDEO` video-evidence contract.
