# Workflow: test-suite

> Orchestrator workflow for `/jlu-test-suite` (no arguments).
>
> Resolves the service from the current working directory, runs its unit and integration suites with the **minimum worker count** (`1`), and reports failures grouped by the component under test (Controller, Service, Repository, Middleware, Guard/Interceptor, DTO/Entity, Handler, Util, Module).
>
> **Scope:** local pre-PR validation. The CI still runs the full suite on push — this skill is for the developer who wants a richer signal locally without saturating the machine.

---

## Principles

- **Cero argumentos.** Invocas y se acaba. La skill no negocia, no pregunta, no acepta flags.
- **Workers = 1.** Mínimo absoluto. La skill garantiza que no satura CPU ni memoria; tarda lo que tenga que tardar.
- **Reporte rico.** Cuando algo falla, el dev ve qué componente (Controller, Service, etc.) y dónde, no un mar de stack traces sin estructura.
- **Sin auto-fix.** La skill valida. Las decisiones sobre fixes son del dev.

---

## Step 1 — Resolve service from cwd

1. Locate the workspace: walk up from `{cwd}` (max 5 levels) looking for `.spec-workspace/`. If not found, stop with:
   > "/jlu-test-suite requires a workspace. Run /jlu-map-codebase first or invoke this from inside a workspace-registered service."

2. Read `<workspace>/registry/services.yaml`.

3. For each service entry, resolve `path` against the workspace root. Find the entry whose resolved `path` is a **prefix of cwd** (longest-prefix match if multiple match).

4. **If no service matches**: stop with an explicit error:
   > "Current directory `{cwd}` is not inside any registered service. Registered services:
   > - `<id>` → `<resolved-path>`
   > - …
   > `cd` into one of these and re-invoke."

**Store**: `SERVICE_ID`, `SOURCE_ROOT` (matched service path, absolute).

---

## Step 2 — Resolve effective source path (worktree-aware)

The dev may be on a `production/<slug>` or `staging/<slug>` branch in a worktree. Honor that.

1. Run `git -C "$SOURCE_ROOT" rev-parse --abbrev-ref HEAD` to read the current branch.
2. If the branch is `production/<slug>` or `staging/<slug>`, look for `TASKS.md` at `<workspace>/specs/*/<slug>/TASKS.md`.
3. If `TASKS.md` exists and its `## Branching` section says `Mode: worktree`, prefer `<SOURCE_ROOT>/.worktrees/<slug>/` (when it exists on disk).
4. Otherwise use `SOURCE_ROOT` directly.

If the resolved worktree path is missing, fall back to `SOURCE_ROOT` and log a one-line warning.

**Store**: `EFFECTIVE_PATH`.

---

## Step 3 — Pre-flight RAM gate (lightweight)

With workers fixed at 1, the gate exists only to fail-fast on truly degraded machines, not to refuse normal runs.

```bash
OS=$(uname -s)
if [ "$OS" = "Linux" ] && grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
  OS_VARIANT="WSL2"
else
  OS_VARIANT="$OS"
fi

case "$OS_VARIANT" in
  Linux|WSL2)
    AVAIL_MB=$(awk '/MemAvailable/ {print int($2 / 1024)}' /proc/meminfo 2>/dev/null)
    ;;
  Darwin)
    PAGE_SIZE=$(sysctl -n hw.pagesize)
    FREE=$(vm_stat | awk '/Pages free/ {gsub(/\./,"",$3); print $3}')
    SPEC=$(vm_stat | awk '/Pages speculative/ {gsub(/\./,"",$3); print $3}')
    INACT=$(vm_stat | awk '/Pages inactive/ {gsub(/\./,"",$3); print $3}')
    AVAIL_MB=$(( (FREE + SPEC + INACT) * PAGE_SIZE / 1024 / 1024 ))
    ;;
  *)
    AVAIL_MB=0
    ;;
esac

REQUIRED_MB=1500
if [ "$AVAIL_MB" -gt 0 ] && [ "$AVAIL_MB" -lt "$REQUIRED_MB" ]; then
  echo "## /jlu-test-suite paused — insufficient RAM"
  echo "  available:  ${AVAIL_MB} MB"
  echo "  required:   ${REQUIRED_MB} MB (with workers=1)"
  echo "  Close apps (Chrome, IDE-heavy plugins, dev services) and retry."
  exit 2
fi
```

If exit 2 fires, return that as the workflow's exit code.

---

## Step 4 — Detect runner and tier commands

1. Read `<workspace>/services/<SERVICE_ID>/codebase/CONVENTIONS.md` if it exists.

2. Look for the **"Test Filtering Commands"** table (populated by `/jlu-map-codebase`). Extract:
   - `UNIT_CMD` — row "Run unit tests only"
   - `INTEGRATION_CMD` — row "Run integration tests only"
   - `ALL_CMD` — row "Run all tests"

3. If the table is missing, fall back to manifest introspection at `EFFECTIVE_PATH`:
   - `package.json` exists → read `scripts.test` and inspect `devDependencies` for the runner. Set `UNIT_CMD = INTEGRATION_CMD = ALL_CMD = npm test`.
   - `pyproject.toml` exists → `UNIT_CMD = INTEGRATION_CMD = pytest`.
   - `go.mod` exists → `UNIT_CMD = INTEGRATION_CMD = go test ./...`.
   - None of the above → exit 3 with: `"Cannot detect test runner. Add a 'Test Filtering Commands' table to CONVENTIONS.md or a 'test' script to package.json/pyproject.toml."`

4. Detect the underlying runner (`RUNNER`):
   - `package.json devDependencies` contains `jest` → `RUNNER=jest`
   - contains `vitest` → `RUNNER=vitest`
   - contains `mocha` → `RUNNER=mocha`
   - `pyproject.toml` / `requirements*.txt` references `pytest` → `RUNNER=pytest`; if `pytest-xdist` is present too, set `HAS_XDIST=true`.
   - `go.mod` present → `RUNNER=go`
   - Unknown → `RUNNER=unknown` (will skip worker injection, log a warning)

5. **Inject worker cap = 1 into each command.** Append the appropriate flag(s):

| RUNNER | Append to command |
|--------|-------------------|
| jest | `-- --runInBand` (the `--` separates npm args from jest args) |
| vitest | `-- --pool=threads --poolOptions.threads.maxThreads=1` |
| mocha | (none — single-process by default) |
| pytest + xdist | `-n 1` |
| pytest (no xdist) | (none — single-process) |
| go | `-p 1` |
| unknown | (none, log warning: `"Worker cap not applied — unknown runner. Test suite may use default parallelism."`) |

**Store**: `UNIT_CMD`, `INTEGRATION_CMD`, `ALL_CMD`, `RUNNER`, all with the worker cap appended where applicable.

---

## Step 5 — Execute the suites

Run sequentially. Always log the exact command before invocation.

### 5a. Unit tests

```bash
cd "$EFFECTIVE_PATH"

UNIT_JSON="$(mktemp -t jlu-test-unit-XXXXXX.json)"
echo "## Running unit tests"
echo "    \$ ${UNIT_CMD_WITH_JSON_FLAG}"
eval "${UNIT_CMD_WITH_JSON_FLAG}" 2>&1 | tee "${UNIT_LOG}"
UNIT_EXIT=$?
```

Where `UNIT_CMD_WITH_JSON_FLAG` adds a structured-output flag when the runner supports it (so Step 6 can parse failures programmatically):

| RUNNER | Append for structured output |
|--------|------------------------------|
| jest | `--json --outputFile="$UNIT_JSON"` |
| vitest | `--reporter=json --outputFile="$UNIT_JSON"` |
| pytest + `pytest-json-report` | `--json-report --json-report-file="$UNIT_JSON"` |
| pytest (no json-report plugin) | (none; parse stdout) |
| go | `-json > "$UNIT_JSON"` (Go's `-json` writes line-delimited JSON to stdout) |
| mocha | (none usually; parse stdout) |
| unknown | (none) |

### 5b. Integration tests (only if separate from unit)

```bash
if [ "$INTEGRATION_CMD" != "$UNIT_CMD" ]; then
  INT_JSON="$(mktemp -t jlu-test-integration-XXXXXX.json)"
  echo "## Running integration tests"
  echo "    \$ ${INTEGRATION_CMD_WITH_JSON_FLAG}"
  eval "${INTEGRATION_CMD_WITH_JSON_FLAG}" 2>&1 | tee "${INT_LOG}"
  INT_EXIT=$?
else
  INT_EXIT=0  # already covered by UNIT_CMD
fi
```

### 5c. Quick exit when both green

If `UNIT_EXIT == 0` AND `INT_EXIT == 0`:

```
## Test Suite — PASS

- Unit: <U_pass>/<U_total> passing
- Integration: <I_pass>/<I_total> passing (or "covered by unit suite — no separate integration run")
- Runner: <RUNNER>, workers: 1
- Effective path: <EFFECTIVE_PATH>
```

Exit 0. Skip Step 6.

---

## Step 6 — Enriched failure report (only when something failed)

This step requires reading test files and inferring components. Best results in Sonnet or higher.

### 6a. Parse failures

For each runner, extract the failure list. Schema per failure:

```
{
  "test_file": "src/auth/__tests__/auth.service.spec.ts",
  "test_name": "verifyToken rejects expired tokens",
  "line": 42,
  "error_message": "Expected status 401; received 500",
  "stack_excerpt": "<2-3 lines of relevant stack, no node_modules>"
}
```

Per runner:

- **Jest / Vitest**: parse `UNIT_JSON`. Failures are at `testResults[*].assertionResults[*].status == "failed"`.
- **pytest + json-report**: failures at `tests[*]` where `outcome == "failed"`.
- **pytest (no plugin)**: parse stdout. Failure blocks start with `FAILED <path>::<name>` lines and continue with the error block until the next test start or final summary.
- **Go (`-json`)**: failures are events with `Action == "fail"`. Each `Package` + `Test` combo is one failure; the prior `output` events for the same `Test` form the error excerpt.
- **Mocha**: parse stdout for `failing` lines (e.g., `1) <describe path> > <test name>` followed by an error indented block).

If structured output is not available and stdout parsing yields no failures despite a non-zero exit code, surface the last 50 lines of the log and exit 1 with: `"Test suite failed but the failure list could not be parsed. Output captured at <log path>."`

### 6b. Classify each failure by component

For each failure:

1. **Find the test's subject** — what's the code under test:
   - **JS/TS (Jest/Vitest)**: read the test file (`Read`). Find the outermost `describe('<Subject>', ...)` block containing the failing test. If `<Subject>` matches an imported identifier (e.g., `import { AuthService } from '../auth.service'`), the subject is the file behind that import. Otherwise heuristically pick the **first** import that isn't a stdlib / testing util / mock helper.
   - **pytest**: the test file is `test_<module>.py` → subject file is `<module>.py` in the same package (look one directory up if not adjacent). For class-based tests (`class TestX:`), the subject is `<X>` or `<X.py>`.
   - **Go**: the test file is `<x>_test.go` → subject is `<x>.go` in the same package.
   - **Mocha / other JS**: same as Jest/Vitest.

2. **Resolve subject path** (the actual file behind the subject) and read its basename.

3. **Map basename suffix to component type**. Use this default mapping, but **override with CONVENTIONS.md** if it defines a custom Naming Conventions section:

| Basename pattern | Component type |
|------------------|----------------|
| `*.controller.{ts,js,py}` | Controller |
| `*.service.{ts,js,py}` | Service |
| `*.repository.{ts,js,py}`, `*.repo.{ts,js}`, `*Repository.{java,kt}` | Repository |
| `*.middleware.{ts,js}` | Middleware |
| `*.guard.{ts,js}`, `*.interceptor.{ts,js}`, `*.pipe.{ts,js}`, `*.filter.{ts,js}` | Guard/Interceptor |
| `*.dto.{ts,js}`, `*.entity.{ts,js}`, `*.schema.{ts,js}`, `*.model.{ts,js,py}` | DTO/Entity |
| `*.handler.{ts,js,go}`, `*.command.{ts,js}`, `*.query.{ts,js}` | Handler |
| `*.util.{ts,js,py}`, `*.helper.{ts,js,py}`, `*.utils.{ts,js,py}` | Util |
| Anything else | Module |

4. **Cache** the subject → component mapping per session to avoid re-reading the same file when multiple tests share a subject.

### 6c. Group + render the report

Group failures by `(subject_file, component_type)`. Sort groups by failure count descending. Render:

```
## Test Suite — FAIL (<N_unit> unit · <N_int> integration)

### <SubjectName> (<subject_file>) — <count> failure(s) — <ComponentType>

✗ <test_name>
  <test_file>:<line>
  <error_message — first 3 lines, no node_modules paths>
  <one-line diff or "expected X, got Y" if available>

✗ <next test in same subject…>

### <Next subject…>

…
```

- `<SubjectName>` is the class/identifier name from the `describe(...)`, the `TestX` class for pytest, or the basename without suffix as a fallback.
- Each failure entry is exactly 3–5 lines. No huge stack traces. If the dev needs the full stack, they can rerun the specific test manually.
- Strip `node_modules/`, `dist/`, and absolute home paths from the printed paths.

### 6d. Integration-failure hints

If any integration-tier failure's error message matches any of these patterns, append a hint line under it:

- `ECONNREFUSED`, `connection refused`, `Connection refused`
- `getaddrinfo ENOTFOUND`, `Name or service not known`
- `Pool exhausted`, `connect timeout`, `ETIMEDOUT`
- `MongoServerSelectionError`, `Connection terminated`

Hint format:

> `↪ Dev infrastructure appears unreachable. Did you run /jlu-start-dev?`

### 6e. Final summary

After the per-component sections:

```
### Summary
- Unit:        <U_pass>/<U_total> passing · <U_fail> failing
- Integration: <I_pass>/<I_total> passing · <I_fail> failing  (or "n/a — covered by unit suite")
- Components with failures: <ComponentType list, comma-separated>
- Effective path: <EFFECTIVE_PATH>
- Workers: 1
```

Exit 1.

---

## Step 7 — Cleanup

```bash
rm -f "$UNIT_JSON" "$INT_JSON" "$UNIT_LOG" "$INT_LOG"
```

Temporary log files in `/tmp` are best-effort — failing to delete them is not an error.

---

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | All tests green |
| 1 | One or more tests failed (report rendered) |
| 2 | Pre-flight RAM gate failed |
| 3 | Test runner could not be detected |

---

## Error handling

| Error | Action |
|-------|--------|
| cwd not inside any registered service | Stop with service list (Step 1) |
| `.spec-workspace/` not findable | Stop with `/jlu-map-codebase` hint |
| Pre-flight RAM aborts | Exit 2, clear remedy |
| Runner not detectable | Exit 3, suggest CONVENTIONS.md fix |
| Runner crashes mid-suite (process killed, OOM) | Print last 50 lines of log + exit 1 |
| Structured output parsing fails | Surface log path + exit 1 |

---

## Notes

- **Single-service by design.** To validate multiple services in one task, invoke `/jlu-test-suite` once per service from each `cd`. V2 may add a `--all-affected` flag that reads TASKS.md.
- **Workers fixed at 1.** Literal interpretation of "minimum workers". There is no env var override in V1 — if you need more parallelism, run the underlying runner directly.
- **Coverage is out of scope.** Step 8c (QA) reads coverage reports statically; this skill never runs `--coverage` to keep RAM predictable.
- **Sonnet+ recommended.** Step 6 (failure classification) reads test files and infers component types. Haiku can produce wrong classifications on projects with non-standard naming.
- **CI parity.** This skill's results should match the CI for unit + integration; if they don't, suspect runner version drift or env vars set in CI that aren't in your shell.

---

## Artifact paths

| Artifact | Path |
|----------|------|
| CONVENTIONS.md (read) | `.spec-workspace/services/<service-id>/codebase/CONVENTIONS.md` |
| services.yaml (read) | `.spec-workspace/registry/services.yaml` |
| TASKS.md (read for worktree resolution) | `.spec-workspace/specs/<date>/<task-slug>/TASKS.md` |
| Temp JSON output | `/tmp/jlu-test-unit-*.json`, `/tmp/jlu-test-integration-*.json` |
| Temp log capture | `/tmp/jlu-test-unit-*.log`, `/tmp/jlu-test-integration-*.log` |
