# Workflow: ui-qa-run

Boot only the services this task affects, run the Playwright E2E suite headless single-worker, and on failure dispatch the bounded fix-loop. User-triggered post-deploy gate.

## Inputs

- Optional argument: task slug. When omitted, parsed from the current git branch (`production/<slug>` or `staging/<slug>`). Off-task branches refuse with: "no task slug detected from branch `<X>`; pass `<slug>` explicitly."
- Optional flags:
  - `--force` — override the pre-flight resource gate (use sparingly).
  - `--allow-shared-data` — required when any affected service has `dev.data_isolation: shared`.
  - `--allow-test-edits` — let the fix-loop edit `.spec.ts` files (default forbids this).
  - `--allow-prod-target` — override the anti-prod E2E target gate (use sparingly; see Phase 3 step 15). Sets `ALLOW_PROD_TARGET=1` for the run.
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

3. **Locate the task directory.** Do not glob directories directly. Use marker files and derive `TASK_DIR = dirname(<marker>)`:
   - `.spec-workspace/specs/*/$SLUG/TASKS.md`
   - fallback: `.spec-workspace/specs/*/$SLUG/SPEC.md`
   - fallback: `.spec-workspace/specs/*/$SLUG/PROPOSAL.md`

   Refuse if no marker file is found.

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

   b'. **Playwright infrastructure check + bootstrap gate.** Before any `jlu-ui-e2e-writer` dispatch for this UI service, resolve its active worktree (via `jelou/references/worktree-resolution.md`) and check whether Playwright infra exists:

      - `@playwright/test` is present in the worktree's `package.json` (`dependencies` or `devDependencies`), AND
      - a `playwright.config.{ts,js}` exists at the worktree root OR at `tests/e2e/`.

      **If both present:** record the resolved config path (root vs `tests/e2e/`) as `PLAYWRIGHT_CONFIG` for Phase 3 step 15, then continue to step 7c.

      **If either is missing:** run the bootstrap gate. Invoke `AskUserQuestion`:

      > "`<UI_SERVICE_ID>` has no Playwright infrastructure. I will create in your repo: `tests/e2e/playwright.config.ts`, `tests/e2e/fixtures/auth.ts`, and add `@playwright/test` (devDependency) and install it. Proceed?"

      - **Declined** → abort with `STATUS: BLOCKED`, exit 2: "Playwright infra required for `<UI_SERVICE_ID>`; E2E is mandatory for frontend changes."
      - **Accepted** → dispatch `jlu-ui-e2e-writer` with `MODE=bootstrap` and `EXPECT=live` (passing `<TASK_DIR>`, `<UI_SERVICE_ID>`, `<UI_SERVICE_WORKTREE>`). This workflow is post-deploy — the UI exists, so the writer must skip its RED-verification run (the orchestrator runs the suite itself in step 15). The agent scaffolds the infra and then derives `user-flow.md` + specs (it falls through to `derive-from-spec`). If the agent reports `BLOCKED` (install failed) → abort with exit 2 and surface the manual install command it quoted. On success, set `PLAYWRIGHT_CONFIG=tests/e2e/playwright.config.ts` and mark this service's derivation **already done** — skip the separate `MODE=derive-from-spec` dispatch in step 7c.

   c. **If no user-flow.md exists AND step 7b' did not already bootstrap this service**, do NOT exit. The spec is the source of truth — the workflow must derive scenarios from it regardless of whether `/jlu:refine-task` was previously invoked. (When step 7b' dispatched `MODE=bootstrap`, derivation already happened — skip this dispatch.) Dispatch `jlu-ui-e2e-writer` once with `MODE=derive-from-spec` and `EXPECT=live` (post-deploy: the writer skips its RED-verification run) to:
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

14b. **Auth gate — probe the session, log in via OTP when invalid.** Runs after boot (the target app must be up) and before Playwright. See `jelou/references/auth-fixtures.md` § "Orchestrated OTP login".

    ```bash
    export UI_WORKTREE E2E_BASE_URL E2E_STORAGE_STATE
    if node "$PLUGIN_ROOT/bin/e2e-session-probe.mjs"; then
      echo "auth gate: stored session valid — continuing"
    else
      AUTH_GATE=login_required
    fi
    ```

    When `AUTH_GATE=login_required`:

    1. Verify `TEST_EMAIL` and `TEST_PASSWORD` are declared **by name** in `.env` / `.env.e2e` (`grep -qE '^TEST_EMAIL=' ...`). Missing → abort `STATUS: BLOCKED`, exit 2, naming the variables. Never print values (guard-env-reads enforces).
    2. Read `.spec-workspace/e2e-auth.yaml` (flat keys: `otp_from`, `otp_subject_regex`, `otp_code_regex`). Missing file → ask the user ONCE via `AskUserQuestion` for the OTP mail's sender and subject pattern, then persist the file so future runs never re-ask.
    3. Launch the login driver in the background and watch its stdout:
       ```bash
       OTP_FILE=$(mktemp -u /tmp/jlu-otp-XXXXXX)
       OTP_FILE="$OTP_FILE" node "$PLUGIN_ROOT/bin/e2e-login.mjs" > /tmp/jlu-login.out 2>&1 &
       LOGIN_PID=$!
       ```
    4. When `/tmp/jlu-login.out` shows `WAITING_OTP`: read the OTP from Gmail via the MCP integration — `ToolSearch` for `mcp__claude_ai_Gmail__search_threads`, query `from:<otp_from> newer_than:1h`, take the newest thread, extract the code with `otp_code_regex`. Write it: `printf '%s' "$CODE" > "$OTP_FILE"`.
    5. **Gmail fallback:** tools absent, search fails, or no mail within ~90s → `AskUserQuestion`: "No pude leer el OTP desde Gmail. Pégalo aquí." Write the user's answer to `$OTP_FILE`. No answer / code expired → kill the login process, abort `BLOCKED`.
    6. Wait for the login process and branch on its exit code:
       - `0` → re-run the probe; valid → continue to step 15.
       - `41` → print the 401 abort message (below) and exit `BLOCKED` (2).
       - `42`/`43` → report which OTP step failed; offer ONE retry of the whole gate; second failure → `BLOCKED`.
       - `44` → enter the Feature-2 feedback loop (step 18c): ask the user where the login form lives (route, field hints), set `LOGIN_PATH` from the answer, retry (max 3 rounds).

    **401 abort message (verbatim, both here and in step 17b):**

    > ⛔ **No es posible realizar pruebas: el login está recibiendo Error HTTP 401.** Verifica TEST_EMAIL/TEST_PASSWORD en `.env.e2e` o el estado del servicio de auth.

    **Forbidden under all circumstances:** dispatching the fix-loop for auth failures, inserting or patching session documents in any datastore (Mongo/MySQL/Redis), or editing auth-related env values to force a pass.

15. **Run Playwright** in the UI service's worktree. Source the UI service's `.env` (and optional `.env.e2e` overlay) so Playwright sees the same configuration the dev server is using; refuse to start if any env var declared in `user-flow.md` `Env Vars` is missing, and HEAD-check each URL whose source points outside `Service Boot Order`. See `jelou/references/e2e-environment.md` for the contract.

    ```bash
    cd "$UI_WORKTREE"

    # Opt-in env target: E2E_BASE_URL MUST be declared in .env.e2e, never inherited
    # from the app's .env (which typically points at production). See references/e2e-environment.md.
    if [ ! -f .env.e2e ]; then
      echo "ERROR: .env.e2e missing for $UI_SERVICE. E2E never runs with the app's .env config."
      echo "  Create .env.e2e and set E2E_BASE_URL. See references/e2e-environment.md."
      exit 2
    fi
    if ! grep -qE '^[[:space:]]*E2E_BASE_URL=' .env.e2e; then
      echo "ERROR: .env.e2e for $UI_SERVICE must declare E2E_BASE_URL explicitly."
      exit 2
    fi

    # Load .env (per docker-conventions.md it was copied into the worktree at task creation)
    # then the .env.e2e overlay. set -a exports every assignment to child processes.
    set -a
    [ -f .env ]     && . ./.env
    [ -f .env.e2e ] && . ./.env.e2e
    set +a

    # Mandatory: baseURL must come from env, not be hard-coded in playwright.config.ts.
    : "${E2E_BASE_URL:?missing E2E_BASE_URL — set it in .env.e2e (see references/e2e-environment.md)}"

    # Anti-prod gate (DEFAULT-DENY / fail-closed): only a target the classifier verifies as
    # `safe` runs without --allow-prod-target. Any other class — `prod`, OR an empty/missing
    # result because the classifier could not run — blocks. The test is `!= "safe"`, never
    # `= "prod"`, so a broken invocation can never let a production target through silently.
    # $PLUGIN_ROOT is the absolute plugin root resolved by the SKILL bootstrap (Phase 1); the
    # orchestrator substitutes it here. `|| true` keeps a node failure from aborting under set -e;
    # the empty TARGET_CLASS it yields still fails the `!= "safe"` test and blocks.
    TARGET_CLASS=$(node "$PLUGIN_ROOT/bin/classify-e2e-target.mjs" "$E2E_BASE_URL" 2>/dev/null || true)
    if [ "$TARGET_CLASS" != "safe" ] && [ -z "$ALLOW_PROD_TARGET" ]; then
      echo "ERROR: E2E_BASE_URL points at production or an unverified target ('$E2E_BASE_URL'; class=${TARGET_CLASS:-unknown})."
      echo "  Default-deny: only localhost / *.local / staging|dev|sandbox|qa|test targets run without override."
      echo "  Pass --allow-prod-target if this is intentional."
      exit 2
    fi

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

    # PLAYWRIGHT_CONFIG was recorded in step 7b' (root config → empty; tests/e2e/ config → explicit path).
    CONFIG_FLAG=""
    [ -n "$PLAYWRIGHT_CONFIG" ] && [ "$PLAYWRIGHT_CONFIG" != "playwright.config.ts" ] && CONFIG_FLAG="--config=$PLAYWRIGHT_CONFIG"

    # --trace=retain-on-failure: produces a trace.zip for every failing test on its FIRST
    # run. Never use on-first-retry here — no retries are configured, so on-first-retry
    # records nothing and the fix-loop goes blind; adding retries would double the wall
    # clock of every failing test instead.
    # stderr goes to run.stderr, NOT into run.json — merging them corrupts the JSON reporter output.
    npx playwright test \
      $CONFIG_FLAG \
      --workers=${WORKERS:-1} \
      --reporter=json \
      --output="$TASK_DIR/services/$UI_SERVICE/e2e/playwright-output" \
      --trace=retain-on-failure \
      > "$TASK_DIR/services/$UI_SERVICE/e2e/run.json" \
      2> "$TASK_DIR/services/$UI_SERVICE/e2e/run.stderr"
    EXIT_CODE=$?
    ```

    **Env hygiene (enforced by the plugin's `guard-env-reads` hook).** Never `Read`, `cat`, or otherwise print `.env` / `.env.e2e` contents into the conversation — live secrets in the model context have triggered API-level Usage Policy rejections that kill the session. Check vars by name (`grep -qE '^VAR=' .env.e2e`), append with `printf ... >>`, modify with `sed -i`. Values stay in the shell.

16. **Parse the JSON reporter output** for failures. Each failure has test title, file path, line, error, attached trace.zip path.

    **Zero-test guard (never a false green).** Before treating the run as a pass, check how many tests the reporter actually collected (`stats.expected` plus any `unexpected`/`flaky`, or the presence of `suites`). If **zero tests were collected**, this is a configuration/spec-location problem — the playwright config `testDir` did not resolve to the generated specs — NOT a pass. Abort with `STATUS: BLOCKED`, reason `no_tests_collected`, and point the user at the `testDir` vs generated-spec-location mismatch. A green exit code on an empty run must never be reported as success.

17. **Mid-suite crash detection.** If any test failed:
    ```
    For each booted service:
      Re-run its readiness check (one shot).
      If fails:
        Abort: STATUS: BLOCKED, reason: service_crashed:<id>
        Capture last 50 lines of <service>'s launch log.
        Skip the fix-loop entirely.
    ```

17b. **Mid-suite auth collapse check.** Before dispatching any fix-loop:
    ```bash
    if [ "$(node "$PLUGIN_ROOT/bin/detect-auth-collapse.mjs" "$TASK_DIR/services/$UI_SERVICE/e2e/run.json")" = "auth_collapse" ]; then
      # 3+ consecutive 401-shaped failures — the session died. Fix-loop is forbidden here.
      # Print the step-14b 401 abort message and exit BLOCKED (2).
      exit 2
    fi
    ```

18. **Dispatch fix-loop**. ALL fixes go through the `jlu-ui-fix-loop` agent — the orchestrator MUST NOT edit source or test files inline, run ad-hoc DB queries, or touch any worktree other than the UI service's. Inline fixing bypasses every bound below and has produced 40+ minute unbounded debugging sessions.

    Arm the circuit breaker BEFORE the first dispatch (real enforcement, not prose):

    ```bash
    FIX_DEADLINE=$(( $(date +%s) + 900 ))   # 15-min budget for the whole fix phase
    MAX_FIX_DISPATCHES=10                    # hard cap across all failures
    DISPATCHES=0
    ```

    For each remaining failure:

    a. **Check bounds first.** Before every dispatch:
       ```bash
       if [ "$(date +%s)" -ge "$FIX_DEADLINE" ] || [ "$DISPATCHES" -ge "$MAX_FIX_DISPATCHES" ]; then
         echo "CIRCUIT_BREAKER: fix budget exhausted (${DISPATCHES} dispatches)"
         # remaining failures → flagged in the run report; stop dispatching
       fi
       DISPATCHES=$(( DISPATCHES + 1 ))
       ```
    b. Run `bin/extract-trace.mjs <trace.zip>` to produce `trace-summary.json` (the trace exists on first failure thanks to `--trace=retain-on-failure`).
    c. Dispatch `jlu-ui-fix-loop` with the summary, the failing test source, the SPEC.md context, and the UI service's worktree path. Per-assertion bound: 3 attempts. No test-file edits unless `--allow-test-edits`. No cross-service writes.
    d. **On `DONE`: re-run ONLY the failing spec file** — never the full suite per fix:
       ```bash
       npx playwright test "$FAILING_SPEC" $CONFIG_FLAG --workers=1 --reporter=json \
         --trace=retain-on-failure \
         > "$TASK_DIR/services/$UI_SERVICE/e2e/refix.json" 2> "$TASK_DIR/services/$UI_SERVICE/e2e/refix.stderr"
       ```
       Still failing → next attempt (back to a). Green → next failure.

    When every failure is individually green (or flagged/blocked), run the **full suite exactly once** (step 15 command) to confirm no cross-test regressions. New failures in that confirmation run do NOT re-enter the fix-loop — flag them in the run report; the budget is spent.

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
| `.env.e2e` missing | 2 | "`.env.e2e` missing; create it and set E2E_BASE_URL" + reference to e2e-environment.md |
| `.env.e2e` does not declare `E2E_BASE_URL` | 2 | "declare E2E_BASE_URL in .env.e2e" |
| Login HTTP 401 (gate or mid-suite collapse) | 2 | "⛔ No es posible realizar pruebas: el login está recibiendo Error HTTP 401..." — never auto-patch auth state |
| OTP unreadable (Gmail down/missing mail) | 2 | asks user to paste the OTP; unanswered → BLOCKED |
| Login form not found (exit 44) | 1/2 | enters the feedback loop (3 rounds), then BLOCKED |
| TEST_EMAIL / TEST_PASSWORD undeclared | 2 | "declare TEST_EMAIL and TEST_PASSWORD in .env.e2e" |
| E2E target points at prod, no override | 2 | "E2E_BASE_URL points at production `<url>`; pass `--allow-prod-target` if intentional" |
| No Playwright infra, user declined bootstrap | 2 | "Playwright infra required; E2E mandatory for frontend changes" |
| Bootstrap dependency install failed | 2 | "could not install `@playwright/test`; run `<cmd>` manually" |
| Zero tests collected (config/spec-location mismatch) | 2 | "Playwright collected 0 tests; `testDir` did not resolve to the generated specs — not a pass" |
| Required env var unset | 2 | "required env vars missing: <list>" + reference to e2e-environment.md |
| External dependency unreachable | 2 | "external dependency unreachable: <VAR>=<URL>" (HEAD-check failed pre-flight) |
| Fix budget exhausted (15-min deadline or 10-dispatch cap) | 1 | "CIRCUIT_BREAKER: fix budget exhausted" — remaining failures flagged in the run report |
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
- `bin/e2e-session-probe.mjs` / `bin/e2e-login.mjs` / `bin/detect-auth-collapse.mjs` — auth gate drivers
