# Workflow: production-like

Single production-like test orchestrator. Classifies the task (fullstack vs
full-backend), owns the dev-environment lifecycle (boot once, teardown once via
`jelou/references/env-lifecycle.md`), and delegates test EXECUTION to the existing
skills — inline, never as sub-agents:

- backend services → `/jlu-test-suite` (host unit+integration) + a Testcontainers backend-E2E phase (dependencies only, real HTTP)
- UI services      → `/jlu-ui-qa-run --no-boot` (auth + Playwright against the live stack)

No seed system: reuses `dev` blocks + `data_isolation: per-run`. Testcontainers is permitted ONLY in the backend E2E path (`test/e2e/**`, `*.e2e-spec.ts`), dependencies-only, capped to `WORKERS` (see `subagent-base.md`).

## Inputs

- `ARG` — optional task slug (auto-detected from branch when omitted).
- Flags: `--force`, `--allow-shared-data`, `--allow-prod-target`, `--workers=N`.

## Process

### Phase 1 — Resolve task, classify, gate

1. **Resolve slug** (identical to `ui-qa-run.md` Phase 1 step 1): from `ARG`, else from
   the branch (`production/*` | `staging/*`); refuse if undetectable.
2. **Locate the workspace** (`.spec-workspace/`); refuse if missing.
3. **Locate the task directory** via marker files (`TASKS.md` | `SPEC.md` | `PROPOSAL.md`);
   `TASK_DIR = dirname(<marker>)`; refuse if none.
4. **Acquire the per-task lock** `$TASK_DIR/.production-like.lock` (flock, PID file,
   `trap` release on `EXIT INT TERM`).
5. **Read `affected_services`** from `TASKS.md` frontmatter (fallback: `## Services`
   headings). Refuse if empty: "no affected_services — production-like needs a task."
6. **Build the service list.** For each affected service, read its `services.yaml` entry
   and collect `{ id, stack, description }`. Assemble a JSON array.
7. **Classify.** Run `node <plugin-root>/bin/classify-task-scope.mjs '<json>'` →
   `{ scope, ui_services, backend_services, warnings }`. Print any `warnings`. On exit 1
   (empty/invalid), surface the message and stop.
8. **Compute the Service Boot Order.**
   - `full-backend`: the affected `backend_services` (each must end up with a `dev` block —
     step 8b resolves any that are missing).
   - `fullstack`: the union of (a) each UI service's `user-flow.md` `Service Boot Order`
     (resolved as in `ui-qa-run.md` Phase 1 step 7) and (b) affected backend services.
     Reconcile boot-order conflicts with `ui-qa-run`'s rule (refuse on contradiction).

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
      `jlu-services.json` for `start-dev`, a different registry; production-like reads the
      `dev` block from `services.yaml`.)
   4. **Derivable:** show the rendered `dev:` YAML (the script's `yaml` field) plus any
      `warnings`, then `AskUserQuestion`. **The option set depends on the service type** so a
      UI service can never be silently dropped:
      > "`<service>` has no `dev` block. Inferí este bloque (launcher `<launcher>`, command
      > `<command>`). ¿Lo escribo en `.spec-workspace/registry/services.yaml`?"
      - **Backend service** (`<service> ∉ ui_services`): options **Escribir y continuar** ·
        **Editar yo mismo (abortar)** · **Omitir este servicio**.
      - **UI service** (`<service> ∈ ui_services`, known from the classify step): options
        **Escribir y continuar** · **Editar yo mismo (abortar)** only — no "Omitir"; the prompt
        states skipping a UI service is not permitted (E2E is mandatory for frontend changes,
        per `ui-qa-run.md` step 6).

      Outcomes:
      - **Escribir y continuar** → write the block under that service's entry in
        `.spec-workspace/registry/services.yaml`, re-read the registry, continue.
      - **Editar yo mismo** → refuse with the step 8b.3 message (edit `services.yaml`); do NOT
        improvise.
      - **Omitir este servicio** (backend only) → drop it from the boot order with a one-line
        note; its `test-suite` still runs and surfaces its own "infra unreachable" hint.
   5. After this step every service remaining in the boot order has a `dev` block. The boot
      contract (`env-lifecycle.md`) refuses to boot anything without one.

9. **Pre-flight gate.** Run `preflight_gate` per `jelou/references/env-lifecycle.md` over
   the boot-order services, with `WORKERS=${WORKERS:-1}` and
   `BROWSER_OVERHEAD_MB=$([ "$scope" = fullstack ] && echo 1300 || echo 0)`. Honor
   `--force` / `--allow-shared-data`.

### Phase 2 — Boot once

10. **Boot the Service Boot Order with a per-service reuse-or-reboot decision.** Run
    `boot(Service Boot Order)` per `jelou/references/env-lifecycle.md`, logging to
    `$TASK_DIR/.production-like/launch-<service>.log`. For each service in the order, the FIRST
    action — **before launching it** — is the readiness probe from
    `jelou/references/env-lifecycle.md` (`http_200`/`port_open` on the mapped host port), and the
    probe decides whether the boot step launches it at all:
    - **Healthy** → reuse the already-running process; do NOT add it to `BOOTED[]`, so teardown
      never stops it (it belongs to the developer).
    - **Unhealthy or absent** → boot it fresh with `data_isolation: per-run` and register it in
      `BOOTED[]`/`TEARDOWN_CMD[]` so teardown reclaims it. This makes the run reproducible when no
      live stack exists, and frugal when one does.

    On `ready_timeout` → `STATUS: BLOCKED` (teardown still runs via the trap).

### Phase 3 — Backend execution

11. For each service in `backend_services`: resolve its active worktree
    (`jelou/references/worktree-resolution.md`), `cd` into it, and execute
    `/jlu-test-suite` **inline** (read `jelou/workflows/test-suite.md` and run it for that
    service). Its integration tests now hit the live booted stack. Record PASS/FAIL and the
    grouped failure report. Do NOT abort the run on failure — record and continue.

### Phase 3.5 — Backend E2E (Testcontainers, dependencies only)

11b. For each service in `backend_services`, **serially (concurrency = `WORKERS`, default 1)**:
    1. Resolve its active worktree (`jelou/references/worktree-resolution.md`) and `cd` in.
    2. Discover existing E2E suites by the path convention `test/e2e/**` / `*.e2e-spec.ts`.
    3. **If E2E suites exist:** run them. The suite brings up **dependencies only** (DB/Redis/etc.)
       via Testcontainers in ephemeral isolated containers; the service under test runs on the host
       pointing at those containers and is exercised over real HTTP. Per the
       `Testcontainers E2E` clause in `jelou/references/subagent-base.md`, bring up one dependency
       set at a time and **tear it down before the next service** — no orphaned containers.
    4. **If no E2E suites exist:** re-dispatch `jlu-test-writer` with `--allow-test-edits` and the
       E2E target (write only under `test/e2e/**` / `*.e2e-spec.ts`, dependencies-only) to author
       them, then re-run the suite once to confirm RED→GREEN. production-like remains a runner: it
       never authors a test file itself.
    5. Record PASS/FAIL; never abort the run on failure.

### Phase 4 — UI execution (fullstack only)

12. For each service in `ui_services`: execute `/jlu-ui-qa-run` **inline** with `--no-boot`
    (read `jelou/workflows/ui-qa-run.md` and run its auth gate + Playwright + fix-loop +
    report, skipping gate/boot/teardown). Pass `--allow-prod-target` and `--workers`
    through. Record PASS/FAIL.

### Phase 4.5 — Coverage-breadth + realistic-payload gate (refuse the false green)

A suite can be all-green and still production-thin — a one-happy-path test per requirement (a
filter with `columns: []`, a 1-text-column E2E) exits 0 yet never sends the production payload that
400s. This gate runs ONLY after Phases 3-4 reported all-green; it never re-classifies a suite that
already FAILED. It **RUNS and PROBES — it never authors.** On a breadth gap it re-dispatches the
upstream authors. The data stack is already up and isolated `data_isolation: per-run` (see the top of
this file), so the live probe is safe to mutate.

12b. **Static breadth audit.** For each service in `backend_services`, resolve its worktree and run:
    `node <plugin-root>/bin/probe-coverage-breadth.mjs --service <worktree> --spec $TASK_DIR/SPEC.md --json`.
    It parses the touched DTO/validator surface (files matching `*.dto.*`/`*.schema.*` or carrying
    `@IsNumber`/`@IsUUID`/`@IsString`/`@IsArray`/`@IsBoolean`/`@IsNotEmpty`/`@ValidateNested`
    decorators) against the authored cases (`*.spec.*`/`*.test.*`) and emits
    `{ verdict, uncovered_dimensions, dto_fields_without_rejection, collections_only_empty, cross_field_refs_unpopulated }`.
    It exits `4` when `verdict: thin` (a validated DTO field — request body or typed query parameter —
    has no rejecting-payload test, or a collection/reference field is only ever exercised empty).

12c. **Live realistic-payload probe (active reconnaissance, not authoring).** For each gap the audit
    names, the integration stack is already booted (Phase 2) on isolated `per-run` data. Read the route
    from the controller decorator the DTO binds to, then:
    - send one **rejecting** payload per uncovered validator (a string into `@IsNumber`, a GUID into a
      numeric id, an empty collection where one is required) and record the 4xx — a 4xx the green suite
      never asserted is a CONFIRMED breadth gap (the exact GUID-string-into-`@IsNumber()`-field → 400 shape);
    - send one **realistic success** payload that populates every cross-field reference (a filter naming
      a real column id, collections non-empty) and record the 2xx — an UNCOVERED-SUCCESS gap when no
      authored case sends it. Mutating success probes run ONLY against the isolated `per-run` dev data
      this run booted; never against a shared or prod target (honor `--allow-prod-target` /
      `--allow-shared-data` exactly as the boot gate does).
    The probe never edits files and never persists tests — it only produces the case list for step 12e.

12d. **Verdict downgrade (advisory, never a hard fail).** If the audit verdict is `thin` OR the live
    probe confirmed any gap, the overall verdict is NOT `PASS`: emit `PASS-THIN / NEEDS-BREADTH` and, in
    the report, list every uncovered input dimension with the field name, the validator that rejects it,
    and (for confirmed gaps) the live 4xx/2xx the suite missed. A green-but-thin run is reported as
    explicitly NOT a clean pass. `PASS-THIN` does not block the pipeline — it routes the gap and self-heals.

12e. **Route the gap to the authors (detect, do not duplicate).** On `PASS-THIN`, re-dispatch the
    upstream authors to fill the named cases — **never author them here**: backend gaps → `jlu-test-writer`
    with `--allow-test-edits` and the `uncovered_dimensions` list; UI gaps → `jlu-ui-e2e-writer`
    (`MODE=derive-from-spec`, `--allow-test-edits`) with the uncovered field-type/reference dimensions.
    After they author, re-run the affected suite once (the Phase 3/4 command) to confirm the new cases go
    RED-then-GREEN. production-like remains a runner: it delegates EXECUTION and now also delegates the
    AUTHORING of the missing cases — it never writes a test file itself.

### Phase 5 — Teardown + report

13. Run `teardown(booted)` per `jelou/references/env-lifecycle.md`. This is the trap action
    registered at boot and runs on every exit path (success, failure, abort).
14. **Aggregate report.** Print: `scope`, services booted, a backend section (per-service
    PASS/FAIL with `test-suite`'s grouped failures, plus the Testcontainers backend-E2E PASS/FAIL), a UI section (per-service PASS/FAIL),
    and an overall verdict: `PASS` (all green AND the Phase 4.5 breadth gate clean),
    `PASS-THIN / NEEDS-BREADTH` (all suites green but the breadth gate found uncovered
    validator/reference dimensions — names them and the re-dispatch outcome; advisory, self-heals),
    `FAIL` (any suite failed), or `BLOCKED` (could not boot / pre-flight refused).

## Failure modes & UX

- No workspace / no task marker / empty `affected_services` → refuse with a clear message
  (needs a task created by `/jlu-new-task`).
- Pre-flight gate failure → exit per the env-lifecycle contract; `--force` /
  `--allow-shared-data` override exactly as in `ui-qa-run`.
- Service in the boot order with no `dev` block → step 8b derives one and asks to persist it to
  `services.yaml`; **never improvise a boot command.** Not derivable / user declines → refuse and
  tell the user to add the `dev` block to `.spec-workspace/registry/services.yaml` (NOT
  `/jlu-register-service`, which writes the separate `jlu-services.json`). A UI service without a
  `dev` block is always a hard refuse — it is never offered "Omitir".
- `ready_timeout` on boot → `BLOCKED`; teardown runs.
- A delegated `test-suite` / `ui-qa-run` failure → recorded, run continues, overall `FAIL`,
  teardown runs.
- Lock contention → another `production-like` is active on this task; refuse.
- All suites green but the Phase 4.5 breadth gate finds a validated DTO field with no rejecting-payload
  test, an only-empty collection, or an unpopulated cross-field reference → verdict `PASS-THIN /
  NEEDS-BREADTH`: it names the dimensions, re-dispatches `jlu-test-writer` / `jlu-ui-e2e-writer`
  (`--allow-test-edits`) to author them, and re-runs the affected suite. production-like never authors
  the cases itself (detect and route).

## See also

- `jelou/references/env-lifecycle.md` — the lifecycle contract this workflow owns.
- `jelou/workflows/test-suite.md`, `jelou/workflows/ui-qa-run.md` — the delegated skills.
- `bin/classify-task-scope.mjs` — the scope classifier.
- `bin/probe-coverage-breadth.mjs` — the Phase 4.5 static breadth audit (validator-rejection + realistic-payload coverage).
- `bin/derive-dev-block.mjs` — infers a `dev` block (package-manager-detected) for a service
  that has none, so step 8b can boot it deterministically instead of improvising.
- `jelou/references/dev-block-schema.md`, `jelou/templates/services-yaml.md` — `dev` block
  (incl. the `docker-exec` launcher for idle dev containers).
