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
- UI services      → `jlu-ui-qa-runner` (Playwright against the live stack, no boot of its own); the orchestrator owns only the OTP auth gate before it

No seed system: reuses `dev` blocks + `data_isolation: per-run`. Testcontainers is permitted ONLY in the backend E2E path (`test/e2e/**`, `*.e2e-spec.ts`), dependencies-only, capped to `WORKERS` (see `subagent-base.md`).

## Inputs

- `ARG` — the goal matrix, inline (free text or JSON; see Phase 0). May also carry an
  optional `--task=<slug>` (task slug auto-detected from branch when omitted). Invoked
  with no matrix, the workflow resumes from a previously persisted `$TASK_DIR/GOALS.md`.
- Flags: `--force`, `--allow-shared-data`, `--allow-prod-target`, `--workers=N`,
  `--skip-unbootable` (auto-skip a non-bootable *backend* from the boot order instead of
  refusing — it NEVER drops a UI service; see step 8b.6),
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

1. **Resolve slug**: from `--task=<slug>`, else from the branch (`production/<slug>` |
   `staging/<slug>`). An off-task branch refuses with "no task slug detected from branch
   `<X>`; pass `--task=<slug>` explicitly."
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
     (read every `services/<UI_SERVICE_ID>/user-flow.md` under `TASK_DIR`; step 7.5 has
     already authored any that were missing) and (b) affected backend services. Refuse on
     contradiction: "conflicting boot order across flows: `<flow-a>` says `<X>`; `<flow-b>`
     says `<Y>`. Reconcile in the spec." Never silently pick one.

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

8b. **Resolve missing `dev` blocks — auto-derive + persist, NEVER improvise, NEVER ask.** For
   each service in the boot order whose `services.yaml` entry has **no `dev` block**, do NOT skip
   it and do NOT guess a launcher/command (improvising `docker exec yarn dev` on an npm
   project is the failure this step exists to prevent):

   1. Resolve the service's active worktree (`jelou/references/worktree-resolution.md`).
   2. Derive a candidate block:
      `node <plugin-root>/bin/derive-dev-block.mjs <worktree> --stack <services.yaml stack>`
      (append `--compose-file <docker.compose_file>` when the entry declares one).
      The script detects the package manager from the lockfile and the dev script from
      `package.json`, and emits one of three blocks (or exits `3` with a `reason` when it cannot
      infer one): the idle-dev-container pattern (`Dockerfile.dev` → `CMD sleep infinity`) →
      `launcher: docker-exec`; a compose file with no idle marker (the container runs the app
      itself) → `launcher: docker`; a host dev server → `launcher: npm|shell`.
   3. **Exit 3 (not derivable):** apply the decision table in step 8b.6. Absent
      `--skip-unbootable` — or for any UI service — refuse the whole run: do NOT improvise.
      Print the `reason`
      and: "Add a `dev` block under `<service>` in `.spec-workspace/registry/services.yaml`
      (see `jelou/references/dev-block-schema.md` for the schema, incl. the `docker-exec`
      launcher), then re-run." (Do NOT point at `/jlu-register-service` — that writes
      `jlu-services.json` for `start-dev`, a different registry; goal reads the
      `dev` block from `services.yaml`.) There is nothing to boot-verify here, so this refuse
      message is unchanged.
   4. **Derivable — persist without asking, without marking.** Log the rendered `dev:` YAML
      (the script's `yaml` field) plus any `warnings`, then pipe the block JSON to
      `node <plugin-root>/bin/verify-dev-block.mjs --persist-block --workspace <workspace> --service <service> --block-file -`
      (block JSON on stdin; exit `5` = mtime conflict — a concurrent writer touched
      `services.yaml` — re-read the registry and retry once), re-read the registry, and
      continue. No question is asked and no `verified` mark is written here: the persisted
      block is a hypothesis, and the run's own boot verifies it (step 8b.5). A derivable
      block never interrupts the run — uncertainty about HOW a service boots belongs to the
      preparation phase (`/jlu-map-codebase` certifies at mapping time), never to a
      mid-run pause.
   5. **Trust rule + own-boot verification (no double boot).** For every boot-order service
      that HAS a `dev` block:
      - **Marked and current** — the block carries `verified: { date, commit, block_hash }`
        and its `block_hash` matches
        `node <plugin-root>/bin/verify-dev-block.mjs --hash --workspace <workspace> --service <service>`
        (→ `{ "block_hash": "..." }`) → trust it: boot normally in Phase 2, never re-verify,
        never re-mark.
      - **Unmarked, or hash-mismatched** (a manual edit invalidates the mark mechanically:
        hash mismatch ⇒ treat as unmarked) → the block is a hypothesis, but nothing special
        happens before the boot: **the run's normal Phase 2 boot IS the verification** — no
        standalone verify cycle, no extra boot (the standalone cycle,
        `jlu-dev-block-verifier` + `bin/verify-dev-block.mjs --checkout`, exists only in
        `/jlu-map-codebase`, where no run boots). After the Phase 2 boot, write/update the
        mark ONLY when ALL of these hold:
        - this boot actually **STARTED** the service — its `dev.command` executed because the
          service was booted fresh or rebooted. A reuse of an already-healthy service never
          marks (the same `green-preexisting` semantics as map-time, everywhere); explicit
          command-executed evidence is required — `BOOTED[]` membership or any other
          inference does not qualify when `up -d` merely found the container already serving;
        - readiness passed; and
        - the booted checkout is the **canonical `svc.path`** — a worktree boot trusts or
          re-verifies but NEVER writes the mark.
        Write via
        `node <plugin-root>/bin/verify-dev-block.mjs --write-mark --workspace <workspace> --service <service> --commit <short HEAD sha of the booted checkout>`
        (exit `5` = mtime conflict → re-read and retry once). If the boot FAILS, apply the
        step 8b.6 table: with `--skip-unbootable` and a backend service, drop it with a WARN;
        otherwise refuse with the cause — exactly what a failed boot does today, now with a
        sharper diagnosis. A boot failure never writes a mark.
   6. **Non-bootable services — the `--skip-unbootable` decision table, never a question:**

      | Case | Without the flag | With `--skip-unbootable` |
      |---|---|---|
      | exit-3 or verification-failed, backend service | informative refuse (the step 8b.3 message) | auto-skip + WARN: drop it from the boot order with a one-line note; its `test-suite` still runs and surfaces its own "infra unreachable" hint |
      | exit-3 or verification-failed, UI service | refuse — E2E is mandatory for frontend changes, so a UI service missing a usable `dev` block is a hard error, never a skip: "UI service `<id>` is missing a `dev` block in services.yaml. Add `stack: <react\|nextjs\|vue\|angular\|svelte>` and a `dev` block (command, health_url or ready_signal, ready_timeout_s) per `jelou/references/dev-block-schema.md`, then re-run." | refuse all the same — the flag NEVER drops a UI service |

      `--skip-unbootable` is a dedicated flag: do NOT overload `--force`, which already means
      "skip the preflight RAM gate" and nothing else.
   7. After this step every service remaining in the boot order has a `dev` block. The boot
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

Then capture the two identifiers step 10 needs to execute the plan — the workspace id and one run id
for this whole `/jlu-goal` invocation:

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/workspace.mjs'),
  import('node:crypto')
]).then(([{ computeWorkspaceId }, { randomUUID }]) => {
  process.stdout.write(JSON.stringify({ workspaceId: computeWorkspaceId(process.argv[1]), runId: randomUUID() }));
});
" "{root}"
```

Capture as `{workspaceId}` and `{goalRunId}`, and reuse both verbatim for every step-10 boot.

Persist `{planJson}` to `$TASK_DIR/.goal/boot-plan.json` now, unconditionally — step 10 boots every
task-isolated entry from that file, so it is not a UI-only artifact.

**Frontend→backend wiring.** If `eligible` is non-empty AND `ui_services` is non-empty, the UI must
be pointed at the **allocated** hosts of the task-isolated backends, not at their main dev ports.
For each UI service, rewrite its E2E overlay from the already-persisted
`$TASK_DIR/.goal/boot-plan.json` BEFORE the frontend boots (step 10 always reboots a frontend
fresh, so the bundle bakes these values):

```bash
node "{plugin-root}/bin/rewrite-e2e-env.mjs" \
  --ui-worktree "<UI_WORKTREE>" \
  --plan "$TASK_DIR/.goal/boot-plan.json" \
  --workspace "{root}"
```

It rewrites a `frontend.envLocal` key **only when that key's service is `task-isolated` in the
plan**, pointing it at the allocated host. A `shared-reuse` service's key is deliberately left
alone: `hostByService` resolves it from `dev.ports[dev.port_env]`, which is the **container-internal**
port — correct for backend↔backend wiring over the compose network, wrong for a browser that needs
the published host port. Overwriting those would break URLs that already work. Every other line,
credentials included, is preserved byte-for-byte. It prints the managed key→URL map; never echo the
file itself. Pass
`--frontend-host <port>` only when you need `E2E_BASE_URL` repointed too — omitted, the overlay's
own base URL is left alone.

Exit codes: **4** = the overlay is absent (it carries credentials this tool cannot synthesize —
create it, then re-run; booting the frontend without it bakes production URLs into the bundle).
**5** = a `frontend.envLocal` service has no host in the plan; wire it or drop the key rather than
serving `http://localhost:undefined`. Either exit means the UI half cannot run — do NOT boot the
frontend against a stale overlay.

Never hardcode a port in the overlay: allocation shifts run to run as the eligible set changes.

### Phase 2 — Boot once

10. **Boot the Service Boot Order with a per-service reuse-or-reboot decision.** Run
    `boot(Service Boot Order)` per `jelou/references/env-lifecycle.md`, logging to
    `$TASK_DIR/.goal/launch-<service>.log`.
    **Per-service plan branch (from Phase 2.0).** Before the reuse-or-reboot decision below, check
    the service's entry in `{planJson}` (match by `id`):
    - **Task-isolated entry** (`policy: 'task-isolated'`): boot it with `bin/boot-stack.mjs`, the
      executable form of the `## Plan-driven boot` **task-isolated** contract in
      `jelou/references/env-lifecycle.md`. **Do NOT transcribe those steps here.** The runner
      writes `descriptor.files[]` (the field is `content`, singular), persists nothing it did not
      emit, runs `up` → `install` → `migrate` → `exec`/`restart`, carries the `--env-file` args
      from `environmentFiles` and the `restart` step that a hand-written
      `docker exec -d … sh -lc` silently drops, polls `descriptor.readiness` on the allocated host
      port for the service's own `ready_timeout_s`, and **leaves what it started running**:

      ```bash
      node "{plugin-root}/bin/boot-stack.mjs" \
        --workspace-id "{workspaceId}" --slug "{slug}" --run-id "{goalRunId}" \
        --plan-file "$TASK_DIR/.goal/boot-plan.json" --only "<service>"
      ```

      It prints `{ services, skipped, green, degraded, down, mutations }` and exits 0 only when
      `down` is empty. Then:
      - `green` → register `BOOTED+=(<service>)` and `TEARDOWN_CMD[<service>]="docker compose -p
        <mutations[].resource.projectName> down"` from the returned `mutations`, and SKIP the
        reuse-or-reboot decision below for this service (it is fully booted).
      - `degraded` → the service answers on its port but never matched its declared
        `ready_signal`. Treat it as booted, register it the same way, and WARN
        `⚠ <service>: serving, but its registry ready_signal is stale`.
      - `down` → read `services[].cause` and `services[].error_hints` and apply the failure
        table below. WARN if `entry.imageResolved` is false.

      **Never boot with `verifySharedReuse`** — it tears down in a `finally` everything it
      started, so a stack booted through it is down the moment it returns. `boot-stack.mjs` calls
      `bootSharedReuse`, which does not.

      **Dependency provisioning is a gate, not a WARN.** The runner returns
      `cause: 'deps_install_failed: …'` and never execs the dev command, so no readiness budget is
      burned. Report the cause and apply the step 8b.6 `--skip-unbootable` decision table
      (backend → informative refuse, or auto-skip + WARN with the flag; UI → always refuse).
      Record it in `GOALS.md`'s environment notes as `deps_install_failed` with the service,
      `depsProvision.source` and `depsProvision.lockFile`.

      **A declared `dev.migrate` is a gate too.** `cause: 'migrate_failed: …'` means the service
      booted against a schema its code does not expect — the same decision table applies. A
      non-blocking migration failure surfaces in `error_hints` instead and the service still boots.
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
        `env-lifecycle.md` boot(). The overlay it sources was already repointed at the
        task-isolated backends by the Phase 2.0 frontend→backend wiring step — boot the frontend
        only after that step succeeded.
    - **Unhealthy, absent, or stale** → boot it fresh with `data_isolation: per-run` and register
      it in `BOOTED[]`/`TEARDOWN_CMD[]` so teardown reclaims it. This makes the run reproducible
      when no live stack exists, and frugal when one does.

    On `ready_timeout` → `STATUS: BLOCKED` (teardown still runs via the trap). Print the
    readiness log's error-shaped lines with the verdict — a bare "readiness timed out after N
    seconds" makes the next agent re-read the log by hand. For a task-isolated entry those lines
    are already in the runner's `services[].error_hints`; print those instead of re-deriving them.
    For anything else, extract them with the same helper the
    dev-block verifier uses, never by hand-rolling a grep. **Read the log through
    `descriptor.readiness.logSource`, never with `node:fs` against a `/tmp` path.** On a
    task-isolated boot that path lives INSIDE the container, so a host `readFile` returns
    ENOENT — or, worse, a stale same-named host file — exactly when the diagnosis matters.
    The descriptor already says where the log is
    (`bin/lib/boot-engine/launcher.mjs` `taskLogSource`):
    - `logSource.mode === 'exec-file'` → `docker exec <logSource.container> cat <logSource.path>`
      (the `env-lifecycle.md` step 4b shape).
    - `logSource.mode === 'docker-logs'` → `docker logs <logSource.container>`
    - a `shared-reuse` host launcher with no `logSource` → the host launch log
      (`$TASK_DIR/.goal/launch-<service>.log`).

    Pipe whichever command applies into the helper on stdin:
    ```bash
    docker exec <logSource.container> cat <logSource.path> | node -e "
    import('<plugin-root>/bin/lib/boot-engine/execute-shared-reuse.mjs').then(async (m) => {
      const chunks = [];
      for await (const c of process.stdin) chunks.push(c);
      process.stdout.write(m.errorHints(Buffer.concat(chunks).toString('utf8')).join('\n'));
    });
    "
    ``` A missing-module cause is
    NOT expected here anymore: `env-lifecycle.md` step 4b provisions dependencies from the
    worktree lockfile before
    the dev command runs, and fails the service at the gate instead. If a `Cannot find module`
    still reaches this timeout, the boot's dependency source is one `env-lifecycle.md` step 4b
    does not model —
    report it as such rather than retrying.

    **Certification mark (applies the step 8b.5 trust rule).** After each service's boot
    resolves: an unmarked or hash-mismatched `dev` block whose service this boot actually
    STARTED (its `dev.command` executed — a reuse of an already-healthy service never
    marks), on the canonical `svc.path` checkout (a worktree boot never marks), with
    readiness green → write the mark via
    `bin/verify-dev-block.mjs --write-mark` (exit `5` = mtime conflict → re-read and retry
    once). A block already marked with a current hash is not re-marked.

10b. **UI app-mount gate — settle the UI lane's viability BEFORE Phase 3.** For each service
    in `ui_services`, right after its readiness passes, run the app-mount probe
    (`UI_WORKTREE=<worktree> node "<root>/bin/e2e-app-mount-probe.mjs"`,
    default budget 180 s). Server readiness (`http_200`/`port_open`/Vite `Local:`) is NOT
    app readiness: on a large module graph the first browser navigation still pays the full
    dev-transform cost, and mistaking that warm-up for a crash is how a whole UI lane gets
    written off as "the app does not boot" hours later. This probe also pre-warms the module
    graph so Phase 4's suite starts against a warm server.
    - `mounted` → continue; record the mount time in `GOALS.md`'s environment notes.
    - `not_mounted` → apply the single self-correction, then judge: when the service's
      `dev.command` forces a cold optimizer pass on every boot (`--force`, or an
      `rm`/`rimraf` of `node_modules/.vite`), reboot it via its non-force variant
      (`start`/plain `vite`) when the consumer defines one, and re-probe with the full budget.
      Still `not_mounted` → the UI lane is `BLOCKED reason=app_never_mounted` **now**: mark
      every fullstack/frontend objective's UI half UNSATISFIED with the probe evidence,
      surface it to the user immediately, and continue Phase 3 for the backend halves. Never
      discover a dead UI lane at Phase 4 after the backend iterations already ran.

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
   2. **Dispatch `jlu-backend-e2e-runner`** with `<PLUGIN_ROOT>` and `<WORKERS>` (it runs the
      matched suites with Testcontainers
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

   Authoring here is the **primary** path, not a fallback: `/jlu-execute-task` Step 8f was
   retired, so this phase owns backend E2E authoring as well as execution. A suite found via
   `e2e.globs` (a repo whose real-DB HTTP tier already covers the endpoints) is the only case
   where 11b.4 does not author.

### Phase 3.75 — Auth gate (orchestrator-owned)

11c. For each UI service, perform the auth gate inline per
    `jelou/references/auth-fixtures.md` (§ "Orchestrated OTP login", § "Captcha-gated login:
    consumer capture provider", § "Local cookie-guard session provisioning"): probe the
    session with `bin/e2e-session-probe.mjs` and, when invalid, mint a fresh one. The
    drivers self-load `.env`+`.env.e2e` from `UI_WORKTREE` via `bin/lib/env-files.mjs` —
    never `source` an env file (see `jelou/references/e2e-environment.md`). For a **loopback
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
    stale session is NEVER the user's decision to make. The orchestrator MUST run the login
    driver **for the target's class** automatically and regenerate the `storageState` —
    `bin/e2e-login-local.mjs` (after `bin/e2e-ensure-account.mjs`) for a loopback
    `E2E_BASE_URL`, and the Gmail/OTP driver `bin/e2e-login.mjs` only for a genuinely
    remote/prod target. Running the OTP driver at localhost is a defect, not a fallback: it
    exits `EXIT.CAPTCHA_BLOCKED` (47) and blocks the very refresh this guard mandates.
    The orchestrator MUST NOT surface an `AskUserQuestion` offering to "accept the stale session / pause for
    a manual refresh / choose whether to refresh" — presenting that choice is the exact defect
    this guard forbids. `E2E_BASE_URL` and `TEST_EMAIL`/`TEST_PASSWORD` are known because the
    auth drivers self-load `.env.e2e` from `UI_WORKTREE`; never claim the target is unknown and never punt the refresh
    to the user. The ONLY four user prompts the gate may raise are: missing
    `.spec-workspace/e2e-auth.yaml` (one-time OTP sender/subject, persisted so future runs
    never re-ask), the Gmail paste fallback (no fresh OTP mail within ~90 s),
    login-form-not-found (exit 44 — a bounded 3-round "where does the login form live"
    retry), and a genuinely remote captcha capture (exit 47). A green
    Success Criterion that fails live only because the session is stale is closed by refreshing
    the session, not by asking the user to accept the gap.

    **Captcha on a loopback target is a misconfiguration, not a capture trigger.** Exit 47
    at `localhost`/`127.0.0.1` means the local frontend is calling a **prod/remote backend**
    (Turnstile is enforced server-side by prod), so the consumer-capture flow is FORBIDDEN
    there — capturing a prod session is exactly what poisons the next run with a cookie the
    local stack cannot decrypt. Diagnose instead: the frontend's auth base URLs (e.g.
    `NX_REACT_APP_DASHBOARD_SERVER_BASE`, `NX_REACT_APP_API_GATEWAY_BASE_URL`) must point at
    the **local** login backend, `.env.e2e` must override them to `localhost`, and the
    frontend must have been **booted fresh** since — a reused dev server bakes the app's
    `.env` (prod) because the build tool inlines `NX_*`/`VITE_*` at dev-server start and
    **never reads `.env.e2e`** (`jelou/references/e2e-environment.md`). Also confirm
    `VITE_TURNSTILE_ENABLED=false` is in `.env.e2e`. Abort `BLOCKED` with that diagnosis.
    Only a genuinely **remote** `E2E_BASE_URL` (or `--allow-prod-target`) reaches the
    consumer real-Chrome capture flow, and that capture MUST target `E2E_BASE_URL` — never
    a prod fallback.

### Phase 4 — UI execution (delegated; frontend/fullstack objectives)

12. For each service in `ui_services`, dispatch `jlu-ui-qa-runner` with `<PLUGIN_ROOT>` —
    it is the sole owner of the UI E2E execution body (Playwright run, false-green guards,
    crash and auth-collapse detection, the bounded `jlu-ui-fix-loop`, the confirmation pass,
    the run report). The orchestrator never runs Playwright inline.

    **Resolve `PLAYWRIGHT_CONFIG` first.** In the service's resolved worktree: a
    `playwright.config.{ts,js}` at the worktree root → `PLAYWRIGHT_CONFIG` empty; one at
    `tests/e2e/` → `PLAYWRIGHT_CONFIG=tests/e2e/playwright.config.ts`. It is a **required**
    runner input: dispatching without it leaves the run with no `--config`, and a consumer
    whose config lives under `tests/e2e/` collects 0 tests and the whole UI lane reads as
    vacuously green.

    **Runner input contract** (`agents/jlu-ui-qa-runner.md` is the canonical definition):

    | Input | Value the orchestrator passes |
    |---|---|
    | `TASK_DIR` | `$TASK_DIR` — the runner owns only `services/<ui>/e2e/` under it |
    | `UI_SERVICE_ID` | the service id from `ui_services` |
    | `UI_SERVICE_WORKTREE` | the worktree resolved per `jelou/references/worktree-resolution.md` |
    | `PLUGIN_ROOT` | plugin install root (`jelou/references/plugin-root.md`) |
    | `WORKERS` | `${WORKERS:-1}` |
    | `PLAYWRIGHT_CONFIG` | resolved above; empty means "root config" |
    | `ALLOW_PROD_TARGET` / `ALLOW_TEST_EDITS` | the run's flags, both default off |
    | `GREP` | empty on the first pass; `@goal:G<id>` when the convergence loop re-runs one objective |
    | `USER_FEEDBACK` | only on a re-dispatch that answers a prior `NEEDS_CONTEXT` |

    The session is already provisioned by 11c and the stack is already booted, so the runner
    **never boots, never tears down, and never performs the auth gate** — dispatch carries
    `--no-boot` semantics implicitly.

    **Runner output contract.** Parse its last `STATUS:` line:

    | `STATUS:` | Orchestrator response |
    |---|---|
    | `PASS report=<path>` | record green; attribute per-objective by `@goal:G<id>` title tags |
    | `FAIL failures=<json> flagged=<json> ui_breadth_gaps=<json> report=<path>` | record red; non-empty `ui_breadth_gaps` → route the named dimensions to `jlu-ui-e2e-writer` (`MODE=derive-from-spec`, `--allow-test-edits`) and re-dispatch the runner ONCE to confirm RED→GREEN |
    | `BLOCKED reason=<service_crashed\|auth_collapse\|no_tests_collected\|app_never_mounted\|minimal_input_coverage>` | surface the reason and its evidence; a UI lane blocked here is never reported as green |
    | `NEEDS_CONTEXT missing=... tried=... looked_in=...` | **the orchestrator brokers it**: `AskUserQuestion` with those three fields, then re-dispatch the runner with `USER_FEEDBACK=<answer>`. The runner never asks the user itself |

    An objective's UI side is green iff every `@goal:G<id>`-tagged test passed (step 7.5).
    Video recording is on for every run via the `JLU_E2E_VIDEO` contract the runner exports
    (`jelou/references/playwright-conventions.md`) — the loop and the report consume those
    artifacts as evidence.

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
    - backend side red → dispatch jlu-implementer with <PLUGIN_ROOT>, the failing runner
      output, the objective (title + success criteria), SPEC.md, and the service worktree:
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
- Pre-flight gate failure → exit per the `jelou/references/env-lifecycle.md` contract:
  `--force` overrides the RAM/CPU gate, `--allow-shared-data` the `data_isolation: shared`
  refusal. Neither is implied by the other.
- Service in the boot order with no `dev` block → step 8b derives one and persists it to
  `services.yaml` without asking; **never improvise a boot command.** Not derivable (exit 3) →
  refuse and tell the user to add the `dev` block to `.spec-workspace/registry/services.yaml`
  (NOT `/jlu-register-service`, which writes the separate `jlu-services.json`) — unless
  `--skip-unbootable` auto-skips it with a WARN (backend services only, step 8b.6). A UI
  service without a bootable `dev` block is always a hard refuse — the flag never drops a UI
  service.
- `ready_timeout` on boot → `BLOCKED` with the log's `error_hints`; teardown runs.
- `descriptor.install` non-zero on a task-isolated boot (`env-lifecycle.md` step 4b) → that service is not bootable:
  the dev command is never exec'd, the readiness budget is never spent, and the step 8b.6
  `--skip-unbootable` table decides refuse-vs-skip. Never "install on the host and retry" — the
  lockfile install already runs where the container resolves its dependencies.
- A delegated `jlu-test-suite-runner` / `jlu-ui-qa-runner` failure → recorded; the convergence loop owns the
  retry; a red that survives the cap → overall `FAIL / NOT-CONVERGED`, teardown runs.
- **Convergence invariant.** The loop NEVER exceeds `MAX_ITERATIONS`, never
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
- `jelou/workflows/test-suite.md` — the delegated skill.
- `bin/parse-goal-matrix.mjs` — the Phase 0 goal-matrix parser.
- `bin/classify-task-scope.mjs` — the scope classifier.
- `bin/probe-coverage-breadth.mjs` — the Phase 4.5 static breadth audit (validator-rejection + realistic-payload coverage).
- `bin/derive-dev-block.mjs` — infers a `dev` block (package-manager-detected) for a service
  that has none, so step 8b can boot it deterministically instead of improvising.
- `bin/verify-dev-block.mjs` — the step 8b registry surface: `--persist-block` (write a derived
  block), `--hash` (current block hash for the trust rule), `--write-mark` (the `verified`
  mark after this run's own boot started the service). The standalone verify cycle behind the
  same binary (`--checkout`, run by the `jlu-dev-block-verifier` subagent) belongs to
  `/jlu-map-codebase` only — goal never dispatches it, because the run's own boot is the
  verification.
- `jelou/references/dev-block-schema.md`, `jelou/templates/services-yaml.md` — `dev` block
  (incl. the `docker-exec` launcher for idle dev containers).
- `jelou/references/playwright-conventions.md` — the `JLU_E2E_VIDEO` video-evidence contract.
