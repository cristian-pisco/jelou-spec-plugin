# Workflow: production-like

Single production-like test orchestrator. Classifies the task (fullstack vs
full-backend), owns the dev-environment lifecycle (boot once, teardown once via
`jelou/references/env-lifecycle.md`), and delegates test EXECUTION to the existing
skills — inline, never as sub-agents:

- backend services → `/jlu-test-suite` (host unit+integration against the live stack)
- UI services      → `/jlu-ui-qa-run --no-boot` (auth + Playwright against the live stack)

No Testcontainers, no seed system: reuses `dev` blocks + `data_isolation: per-run`.

## Inputs

- `ARG` — optional task slug (auto-detected from branch when omitted).
- Flags: `--force`, `--allow-shared-data`, `--allow-prod-target`, `--workers N`.

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
   - `full-backend`: the `backend_services` that declare a `dev` block. A backend
     service without a `dev` block is noted and skipped at boot; its `test-suite` still
     runs and surfaces the "infra unreachable" hint if its integration tests need the stack.
   - `fullstack`: the union of (a) each UI service's `user-flow.md` `Service Boot Order`
     (resolved as in `ui-qa-run.md` Phase 1 step 7) and (b) affected backend services with
     `dev` blocks. Reconcile boot-order conflicts with `ui-qa-run`'s rule (refuse on
     contradiction).
9. **Pre-flight gate.** Run `preflight_gate` per `jelou/references/env-lifecycle.md` over
   the boot-order services, with `WORKERS=${WORKERS:-1}` and
   `BROWSER_OVERHEAD_MB=$([ "$scope" = fullstack ] && echo 1300 || echo 0)`. Honor
   `--force` / `--allow-shared-data`.

### Phase 2 — Boot once

10. Run `boot(Service Boot Order)` per `jelou/references/env-lifecycle.md`, logging to
    `$TASK_DIR/.production-like/launch-<service>.log`. On `ready_timeout` →
    `STATUS: BLOCKED` (teardown still runs via the trap).

### Phase 3 — Backend execution

11. For each service in `backend_services`: resolve its active worktree
    (`jelou/references/worktree-resolution.md`), `cd` into it, and execute
    `/jlu-test-suite` **inline** (read `jelou/workflows/test-suite.md` and run it for that
    service). Its integration tests now hit the live booted stack. Record PASS/FAIL and the
    grouped failure report. Do NOT abort the run on failure — record and continue.

### Phase 4 — UI execution (fullstack only)

12. For each service in `ui_services`: execute `/jlu-ui-qa-run` **inline** with `--no-boot`
    (read `jelou/workflows/ui-qa-run.md` and run its auth gate + Playwright + fix-loop +
    report, skipping gate/boot/teardown). Pass `--allow-prod-target` and `--workers`
    through. Record PASS/FAIL.

### Phase 5 — Teardown + report

13. Run `teardown(booted)` per `jelou/references/env-lifecycle.md`. This is the trap action
    registered at boot and runs on every exit path (success, failure, abort).
14. **Aggregate report.** Print: `scope`, services booted, a backend section (per-service
    PASS/FAIL with `test-suite`'s grouped failures), a UI section (per-service PASS/FAIL),
    and an overall verdict: `PASS` (all green), `FAIL` (any suite failed), or `BLOCKED`
    (could not boot / pre-flight refused).

## Failure modes & UX

- No workspace / no task marker / empty `affected_services` → refuse with a clear message
  (needs a task created by `/jlu-new-task`).
- Pre-flight gate failure → exit per the env-lifecycle contract; `--force` /
  `--allow-shared-data` override exactly as in `ui-qa-run`.
- `ready_timeout` on boot → `BLOCKED`; teardown runs.
- A delegated `test-suite` / `ui-qa-run` failure → recorded, run continues, overall `FAIL`,
  teardown runs.
- Lock contention → another `production-like` is active on this task; refuse.

## See also

- `jelou/references/env-lifecycle.md` — the lifecycle contract this workflow owns.
- `jelou/workflows/test-suite.md`, `jelou/workflows/ui-qa-run.md` — the delegated skills.
- `bin/classify-task-scope.mjs` — the scope classifier.
- `jelou/references/dev-block-schema.md`, `jelou/templates/services-yaml.md` — `dev` block.
