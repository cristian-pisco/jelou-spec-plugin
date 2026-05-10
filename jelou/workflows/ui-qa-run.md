# Workflow: ui-qa-run

Boot only the services this task affects, run the Playwright E2E suite headless single-worker, and on failure dispatch the bounded fix-loop. User-triggered post-deploy gate.

## Inputs

- Optional argument: task slug. When omitted, parsed from the current git branch (`production/<slug>` or `staging/<slug>`). Off-task branches refuse with: "no task slug detected from branch `<X>`; pass `<slug>` explicitly."
- Optional flags:
  - `--force` — override the pre-flight resource gate (use sparingly).
  - `--allow-shared-data` — required when any affected service has `dev.data_isolation: shared`.
  - `--allow-test-edits` — let the fix-loop edit `.spec.ts` files (default forbids this).
  - `--workers=N` — Playwright worker count. Default 1. Refuses unsafe values unless both RAM and CPU gates pass (or `--force` is set).

## Process

### Phase 1 — Resolve task and pre-flight

1. **Resolve slug.**
   ```bash
   if [ -z "$ARG" ]; then
     BRANCH=$(git rev-parse --abbrev-ref HEAD)
     case "$BRANCH" in
       production/*) SLUG=${BRANCH#production/} ;;
       staging/*)    SLUG=${BRANCH#staging/} ;;
       *)            echo "ERROR: no task slug detected from branch '$BRANCH'; pass <slug> explicitly"; exit 1 ;;
     esac
   else
     SLUG="$ARG"
   fi
   ```

2. **Locate the workspace.** Walk up from the current service repo to find `.spec-workspace/`. Refuse if missing: "this workflow requires a `.spec-workspace/` (created by /jlu-new-task)."

3. **Locate the task directory.** `.spec-workspace/specs/*/$SLUG/`. Refuse if not found.

4. **Acquire the per-task lock.**
   ```bash
   LOCK_FILE="$TASK_DIR/.ui-qa.lock"
   exec 9>"$LOCK_FILE"
   flock -n 9 || {
     HOLDER=$(cat "$LOCK_FILE.pid" 2>/dev/null || echo "unknown")
     echo "ERROR: another /jlu-ui-qa-run is active on this task (PID $HOLDER). Wait or kill it."
     exit 1
   }
   echo $$ > "$LOCK_FILE.pid"
   trap 'rm -f "$LOCK_FILE.pid"; flock -u 9' EXIT INT TERM
   ```

5. **Read TASKS.md frontmatter** for `affected_services`. Frontmatter is the structured source. Fallback to `## Services` markdown headings for legacy tasks (note in report).

6. **Read services.yaml** for each affected service.

   - **Non-UI services** without a `dev` block: skip with one-line note.
   - **UI services** (detected per Step 11) without a `dev` block: this is a hard error, not a skip. E2E is mandatory for any frontend change regardless of MVP/scope status. Refuse with:
     > "UI service `<id>` is missing a `dev` block in services.yaml. E2E is mandatory for frontend changes. Add `stack: <react|nextjs|vue|angular|svelte>` and a `dev` block (command, health_url or ready_signal, ready_timeout_s) per `jelou/references/dev-block-schema.md`, then re-run."

7. **Resolve user-flow.md per UI service.** For each UI service in `affected_services`:

   a. Look for `services/<UI_SERVICE_ID>/user-flow.md` files inside the task directory.

   b. **If at least one user-flow.md exists**, read them for `Service Boot Order`. Compute the union of declared boot orders across all UI-targeted flows. If two flows disagree on order, refuse: "conflicting boot order across flows: `<flow-a>` says `<X>`; `<flow-b>` says `<Y>`. Reconcile in the spec."

   c. **If no user-flow.md exists**, do NOT exit. The spec is the source of truth — the workflow must derive scenarios from it regardless of whether `/jlu:refine-task` was previously invoked. Dispatch `jlu-ui-e2e-writer` once with `MODE=derive-from-spec` to:
      - Read `<TASK_DIR>/SPEC.md` (Acceptance Criteria, Success Criteria, Functional Requirements that mention UI behavior).
      - Generate `<TASK_DIR>/services/<UI_SERVICE_ID>/user-flow.md` with the standard sections (Problem Statement, Affected UI Service, Routes, Steps, Service Boot Order, Env Vars, Auth Precondition).
      - The agent infers `Service Boot Order` from the union of `affected_services` plus any external endpoints mentioned in the spec; flags ambiguities for human review instead of guessing.
      - The agent infers `Env Vars` from references in the spec to env-controlled URLs/keys; flags missing inferences as `STATUS: NEEDS_CONTEXT`.
      Then return to step 7a and re-read the generated files. The orchestrator commits the generated `user-flow.md` to the task directory before proceeding so the artifact survives across runs.

8. **Pre-flight resource check** (inline; no separate `bin/` script).
   ```bash
   WORKERS=${WORKERS:-1}
   if ! [[ "$WORKERS" =~ ^[0-9]+$ ]] || [ "$WORKERS" -lt 1 ]; then
     echo "ERROR: --workers must be an integer >= 1 (got '$WORKERS')."
     exit 1
   fi

   OS=$(uname -s)
   if [ "$OS" = "Linux" ] && grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
     OS_VARIANT="WSL2"
   else
     OS_VARIANT="$OS"
   fi

   case "$OS_VARIANT" in
     Linux|WSL2)
       AVAIL_MB=$(awk '/MemAvailable/ {print $2 / 1024}' /proc/meminfo 2>/dev/null)
       [ -z "$AVAIL_MB" ] && AVAIL_MB=$(awk '/MemFree/ {f=$2} /^Cached/ {c=$2} END {print (f+c) / 1024}' /proc/meminfo)
       CPU_CORES=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN)
       ;;
     Darwin)
       PAGE_SIZE=$(sysctl -n hw.pagesize)
       FREE_PAGES=$(vm_stat | awk '/Pages free/ {gsub(/\./,"",$3); print $3}')
       SPEC_PAGES=$(vm_stat | awk '/Pages speculative/ {gsub(/\./,"",$3); print $3}')
       INACTIVE_PAGES=$(vm_stat | awk '/Pages inactive/ {gsub(/\./,"",$3); print $3}')
       AVAIL_MB=$(( (FREE_PAGES + SPEC_PAGES + INACTIVE_PAGES) * PAGE_SIZE / 1024 / 1024 ))
       CPU_CORES=$(sysctl -n hw.logicalcpu)
       ;;
     *)
       echo "ERROR: unsupported OS '$OS'. Linux + macOS + WSL2 supported. Windows-native is out of scope."
       exit 1
       ;;
   esac

   # CPU gate: reserve at least half the machine for services/OS. Hard cap at 4 workers.
   MAX_WORKERS_BY_CPU=$(( CPU_CORES / 2 ))
   [ "$MAX_WORKERS_BY_CPU" -lt 1 ] && MAX_WORKERS_BY_CPU=1
   [ "$MAX_WORKERS_BY_CPU" -gt 4 ] && MAX_WORKERS_BY_CPU=4

   if [ "$WORKERS" -gt "$MAX_WORKERS_BY_CPU" ] && [ -z "$FORCE" ]; then
     echo "ERROR: requested --workers=$WORKERS exceeds CPU safety cap ($MAX_WORKERS_BY_CPU with $CPU_CORES logical cores)."
     echo "  Use fewer workers or pass --force to override."
     exit 1
   fi

   # RAM gate: base browser overhead + per-extra-worker overhead.
   REQUIRED_MB=$(( SUM_DEV_RAM_ESTIMATES + 1300 + ((WORKERS - 1) * 700) ))

   if [ "$AVAIL_MB" -lt "$REQUIRED_MB" ] && [ -z "$FORCE" ]; then
      echo "ERROR: pre-flight resource check failed."
      echo "  available: ${AVAIL_MB}MB"
      echo "  required:  ${REQUIRED_MB}MB"
      echo "  workers:   ${WORKERS} (cpu cap: ${MAX_WORKERS_BY_CPU})"
      echo "  Close apps or pass --force to override."
      exit 1
   fi
   ```

9. **Pre-flight port-availability check.** For each affected service's port (from `dev.health_url` or `dev.ready_signal.port`), verify it's free:
   ```bash
   if lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n 2>/dev/null | grep -q LISTEN; then
     echo "ERROR: port $PORT is already bound. Run /jlu-ui-qa-cleanup or kill the holder manually."
     exit 1
   fi
   ```

10. **Data-isolation guard.** If any affected service has `dev.data_isolation: shared` and `--allow-shared-data` was NOT passed, refuse: "service `<id>` declares `data_isolation: shared`. Concurrent runs will corrupt data. Pass `--allow-shared-data` to override."

### Phase 2 — Resolve UI services and worktrees

11. **Identify UI services** in `affected_services`. A service is UI if ANY of:

    - `services.yaml[id].stack` ∈ {`react`, `nextjs`, `vue`, `angular`, `svelte`}.
    - `services.yaml[id].description` matches `/(react|next\.?js|vue|angular|svelte|frontend|UI app|operator app)/i` AND the service is listed in `affected_services` (description-based fallback for services that omit `stack` — common on legacy registrations).

    If a service is detected as UI by description but lacks an explicit `stack` field, emit a one-line warning recommending the registration be tightened (`Run /jlu:refine-task or edit services.yaml to set stack: <framework>`) and continue.

    If a UI service is detected but its `dev` block is missing (Step 6 deferred this to here), refuse with the Step 6 error message — do NOT exit 0.

    If no UI service is detected anywhere in `affected_services`, exit 0 with note "no UI service in affected_services — nothing to do."

12. **Resolve each UI service's active worktree** by calling the algorithm in `jelou/references/worktree-resolution.md`. Pass the resolved path forward; do NOT use `services.yaml[*].path` directly.

13. **For each UI service**, run Phase 3 sequentially. Multi-UI-service tasks iterate one at a time, with full boot+test+teardown per service.

### Phase 3 — Boot, test, teardown (per UI service)

14. **Boot affected services in declared order.**
    ```
    For each service in Service Boot Order:
      Run dev.command (or derived `docker compose -f <compose_file> up -d <service>` when launcher: docker)
      Capture stdout/stderr to <TASK_DIR>/services/<UI_SERVICE>/e2e/launch-<service>.log
      Wait for readiness signal:
        - health_url:    poll until 2xx response, or ready_timeout_s
        - port_open:     TCP connect until success, or ready_timeout_s
        - http_200:      poll until 2xx on port:path, or ready_timeout_s
        - stdout_match:  tail launch log, regex-match pattern, or ready_timeout_s
      On timeout: abort with STATUS: BLOCKED, reason: ready_timeout for <service>.
    ```

15. **Run Playwright** in the UI service's worktree. Source the UI service's `.env` (and optional `.env.e2e` overlay) so Playwright sees the same configuration the dev server is using; refuse to start if any env var declared in `user-flow.md` `Env Vars` is missing, and HEAD-check each URL whose source points outside `Service Boot Order`. See `jelou/references/e2e-environment.md` for the contract.

    ```bash
    cd "$UI_WORKTREE"

    # Load .env (per docker-conventions.md it was copied into the worktree at task creation)
    # and the optional .env.e2e overlay. set -a exports every assignment to child processes.
    set -a
    [ -f .env ]     && . ./.env
    [ -f .env.e2e ] && . ./.env.e2e
    set +a

    # Mandatory: baseURL must come from env, not be hard-coded in playwright.config.ts.
    : "${E2E_BASE_URL:?missing E2E_BASE_URL — set it in .env or .env.e2e (see references/e2e-environment.md)}"

    # Per-flow vars from user-flow.md Env Vars section. The writer agent persists this list to
    # $TASK_DIR/services/$UI_SERVICE/e2e/required-env.txt (one VAR_NAME per line); the orchestrator
    # validates each. Missing → fail-fast with the variable name.
    if [ -f "$TASK_DIR/services/$UI_SERVICE/e2e/required-env.txt" ]; then
      MISSING=()
      while IFS= read -r VAR; do
        [ -z "$VAR" ] && continue
        eval "VAL=\${$VAR-__UNSET__}"
        [ "$VAL" = "__UNSET__" ] && MISSING+=("$VAR")
      done < "$TASK_DIR/services/$UI_SERVICE/e2e/required-env.txt"
      if [ "${#MISSING[@]}" -gt 0 ]; then
        echo "ERROR: required env vars missing for $UI_SERVICE: ${MISSING[*]}"
        echo "  Declare values in .env or .env.e2e per references/e2e-environment.md."
        exit 2
      fi
    fi

    # External endpoints (declared in user-flow.md "External Endpoints" — vars whose source is
    # outside Service Boot Order). HEAD-check each once; refuse to start if unreachable.
    if [ -f "$TASK_DIR/services/$UI_SERVICE/e2e/external-endpoints.txt" ]; then
      while IFS= read -r VAR; do
        [ -z "$VAR" ] && continue
        eval "URL=\${$VAR-}"
        [ -z "$URL" ] && continue
        if ! curl -fsS -o /dev/null --max-time 5 -I "$URL"; then
          echo "ERROR: external dependency unreachable: $VAR=$URL"
          exit 2
        fi
      done < "$TASK_DIR/services/$UI_SERVICE/e2e/external-endpoints.txt"
    fi

    npx playwright test \
      --workers=${WORKERS:-1} \
      --reporter=json \
      --output="$TASK_DIR/services/$UI_SERVICE/e2e/playwright-output" \
      --trace=on-first-retry \
      > "$TASK_DIR/services/$UI_SERVICE/e2e/run.json" 2>&1
    EXIT_CODE=$?
    ```

16. **Parse the JSON reporter output** for failures. Each failure has test title, file path, line, error, attached trace.zip path.

17. **Mid-suite crash detection.** If any test failed:
    ```
    For each booted service:
      Re-run its readiness check (one shot).
      If fails:
        Abort: STATUS: BLOCKED, reason: service_crashed:<id>
        Capture last 50 lines of <service>'s launch log.
        Skip the fix-loop entirely.
    ```

18. **Dispatch fix-loop**. For each remaining failure:
    - Run `bin/extract-trace.mjs <trace.zip>` to produce `trace-summary.json`.
    - Dispatch `jlu-ui-fix-loop` agent with the summary, the failing test source, the SPEC.md context, and the UI service's worktree path.
    - Apply bounds: 3 attempts/assertion, 15-min suite circuit-breaker, no test-file edits unless `--allow-test-edits`, no cross-service writes.

19. **Teardown.** The EXIT trap fires regardless of success/error/SIGINT/SIGTERM:
    ```bash
    trap '
      for svc in "${BOOTED[@]}"; do
        eval "${TEARDOWN_CMD[$svc]}" >/dev/null 2>&1 || true
      done
      flock -u 9
      rm -f "$LOCK_FILE.pid"
    ' EXIT INT TERM
    ```

20. **Write the run report** to `$TASK_DIR/services/$UI_SERVICE/e2e/run-$(date -u +%Y%m%dT%H%M%SZ).md`. Include pre-flight, boot order, per-test pass/fail/flagged, fix-loop activity, artifacts, summary.

21. **Append to TASKS.md** Timeline:
    ```
    | <ts> | UI QA run | <pass>/<total> green, <flagged> flagged. Report: services/<ui>/e2e/run-<ts>.md |
    ```

    Update the YAML frontmatter `affected_services[*].sub_state` for each UI service: `validating` if all green, `blocked` if any flagged.

## Phase 4 — Report

22. Print the same summary the run report contains, with file:line links for any failures and a one-line remediation for each flagged test.

23. Exit code: 0 if all tests green; 1 if any failing or flagged; 2 if BLOCKED (pre-flight / crash / lock).

## Failure modes & UX

| Scenario | Exit | Message |
|---|---|---|
| No `.spec-workspace/` | 2 | "requires a workspace" + how to make one |
| Off-task branch, no slug arg | 2 | "no task slug detected from branch" + how to pass explicitly |
| Invalid `--workers` value | 2 | "--workers must be an integer >= 1" |
| Pre-flight RAM/CPU gate fails | 2 | "available <X>MB < required <Y>MB" or "workers exceed CPU cap" + `--force` hint |
| Port held by stale | 2 | `/jlu-ui-qa-cleanup` hint |
| Lock held | 2 | "PID <X> holds lock; wait or kill" |
| Docker daemon down | 2 | "docker info failed; start Docker Desktop / dockerd" |
| Service ready_timeout | 2 | "<service> didn't reach ready in <X>s; check launch log" |
| Mid-suite service crash | 2 | "service_crashed:<id>; last 50 lines of launch log" |
| UI service missing `dev` block | 2 | "UI service `<id>` is missing a `dev` block" — E2E mandatory for frontend changes; add `stack` + `dev` to services.yaml |
| Required env var unset | 2 | "required env vars missing: <list>" + reference to e2e-environment.md |
| External dependency unreachable | 2 | "external dependency unreachable: <VAR>=<URL>" (HEAD-check failed pre-flight) |
| All tests green | 0 | clean summary |
| Some failing or flagged | 1 | summary with file:line per failure |

## See also

- `jelou/references/loading-context.md` — how the dispatched fix-loop loads its context
- `jelou/references/dev-server-readiness.md` — per-stack ready signal cookbook
- `jelou/references/auth-fixtures.md` — credential security contract
- `jelou/references/dev-block-schema.md` — `services.yaml` `dev` block reference (incl. `env_files` for non-Docker dev servers)
- `jelou/references/e2e-environment.md` — `.env` loading contract for the Playwright runner; required vars; boot-vs-point-at decision; what may be intercepted
- `jelou/references/e2e-anti-patterns.md` — #11 forbids `page.route().fulfill()` of business endpoints
- `bin/extract-trace.mjs` — trace.zip → trace-summary.json
- `agents/jlu-ui-fix-loop.md` — fix-loop agent
- `jelou/workflows/ui-qa-cleanup.md` — recover from leaked state
