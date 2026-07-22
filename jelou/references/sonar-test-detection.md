# Test Command Detection

Auto-detect unit and integration test commands by inspecting the project root. Always prefer commands documented in repo instruction files if present.

## Detection order

1. **Repo instruction docs** — search `CLAUDE.md`, `AGENTS.md`, `.opencode/`, and similar repo-local agent docs for sections like `## Testing`, `### Unit`, `### Integration`, or fenced code blocks tagged with `# unit` / `# integration`.
2. **`package.json` `scripts`** (Node/TS)
3. **`pom.xml`** (Maven)
4. **`build.gradle` / `build.gradle.kts`** (Gradle)
5. **`pyproject.toml` / `pytest.ini` / `tox.ini`** (Python)
6. **`go.mod`** (Go)
7. **`Cargo.toml`** (Rust)
8. **`Makefile`** — look for `test`, `test-unit`, `test-integration`, `integration-test` targets.

## Per-stack matrix

### Node / TypeScript (`package.json`)

Look at `scripts`:

| Script keys present | Unit | Integration |
|---|---|---|
| `test`, `test:integration` | `npm test` | `npm run test:integration` |
| `test:unit`, `test:integration` | `npm run test:unit` | `npm run test:integration` |
| `test`, `test:e2e` (no integration) | `npm test` | `npm run test:e2e` (note in report) |
| `test` only | `npm test` | skip — note "no integration script defined" |
| `jest` configured with projects | `npx jest --selectProjects unit` | `npx jest --selectProjects integration` |

If `pnpm-lock.yaml` exists use `pnpm`; if `yarn.lock` use `yarn`; if `bun.lockb` use `bun`. Otherwise `npm`.

### Maven (`pom.xml`)

- Unit: `mvn -B -q test`
- Integration: `mvn -B -q verify` (verify runs both phases). If the project uses Failsafe with `-DskipITs`, run integration explicitly: `mvn -B -q failsafe:integration-test failsafe:verify`.

### Gradle (`build.gradle*`)

- Unit: `./gradlew test`
- Integration: `./gradlew integrationTest` if the task exists; otherwise check for `intTest`, `integrationTests`. If neither: skip and note.

### Python

- If `pytest` is in deps and a `tests/unit/` and `tests/integration/` layout exists:
  - Unit: `pytest tests/unit -q`
  - Integration: `pytest tests/integration -q`
- If markers are used (`@pytest.mark.integration`):
  - Unit: `pytest -q -m "not integration"`
  - Integration: `pytest -q -m integration`
- If `tox.ini` defines envs `unit` and `integration`: `tox -e unit` / `tox -e integration`.
- For Django projects: `python manage.py test --tag=unit` / `--tag=integration` if tags are defined; otherwise just `python manage.py test`.

### Go

- Unit: `go test ./...`
- Integration: `go test -tags=integration ./...` if the project uses build tags; otherwise check for an `integration_test/` directory and run `go test ./integration_test/...`.

### Rust

- Unit: `cargo test --lib`
- Integration: `cargo test --test '*'` (runs files in `tests/`)

## Edge cases

- **Monorepos** — if the PR diff only touches one package, run tests in that package directory only. Detect via `pnpm-workspace.yaml`, `lerna.json`, `nx.json`, `turbo.json`, or top-level `packages/*/package.json`.
- **Docker-required integration tests** — if the integration command needs `docker compose up` (look for a `docker-compose.test.yml` or a comment in repo instruction docs), STOP and ask the user to start the services first. Do not start containers automatically.
- **Slow suites (>5 min)** — warn the user before running and ask whether to run the full suite or only the affected packages.
- **No tests at all** — if there are no test commands, skip validation (Step 8.6) and note it loudly in the final report. Do not declare success.
- **Tests already broken on base branch** — if unit tests fail before any refactor is applied, stop and tell the user; the PR has a pre-existing problem.

## Pre-check

Before applying any refactor, run the unit test command on the unmodified PR head and record the result. This is the baseline. After refactors, the same suite must still pass — same number of tests, same outcomes. A test that was failing before should not be expected to pass after.

## Sonar re-scan (Step 8.7)

Step 8.7 in `jelou/workflows/resolve-pr.md` may invoke `sonar-scanner` locally to verify issue closure incrementally. Detection:

- Look for `sonar-project.properties` at repo root, or a `sonar` profile in `pom.xml` / `build.gradle`.
- Check `which sonar-scanner` — if absent and the project would benefit, mention it in the report; do NOT auto-install.
- If `sonar-scanner` is unavailable, Step 8.7 falls back to SonarQube MCP `analyze_code_snippet` per modified file plus a re-query of the PR's issues.
- If repo instruction docs document the project's preferred scan command (e.g., `make sonar`, `npm run sonar`), prefer it.
