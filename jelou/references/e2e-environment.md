# E2E Environment — Production-like Contract

> Tests must run against the same services and configuration the consumer uses to run the app — not mocks. This reference codifies how the UI QA workflow loads environment variables, what counts as a "real" backend, and the narrow exceptions where interception is allowed. Read alongside `e2e-anti-patterns.md` and `auth-fixtures.md`.

## Premise

A Playwright suite is only useful when it would catch a regression a real user would hit. That requires:

1. The browser navigates to the same UI bundle a real user would load.
2. Every backend the UI calls is the same backend (or contract-equivalent) a real user would call.
3. Configuration (URLs, feature flags, sandbox keys) comes from the same `.env` the consumer uses to run the dev or staging app.

When any of those drift toward fakes, the suite stops asserting production behavior and starts asserting whatever the test author made up.

## `.env` loading

The UI service's worktree already receives `.env` at task creation time (per `docker-conventions.md` Untracked File Copying). The UI QA workflow loads it again — and an optional `.env.e2e` overlay — into the Playwright process before launching the test runner:

```bash
cd "$UI_WORKTREE"
set -a
[ -f .env ]      && . ./.env
[ -f .env.e2e ]  && . ./.env.e2e
set +a
```

`.env.e2e` is optional. Use it to override the dev defaults for E2E (e.g., point at a sandbox payment URL, raise a rate limit, disable a marketing pixel). Anything not declared in `.env.e2e` falls through to `.env`.

Both files are gitignored on the consumer side. The plugin never commits either.

> **Never inject env by bash-sourcing the files.** The block above is illustrative of *order*, not the mechanism. A real `.env` routinely contains an unquoted value with shell-special characters (`KEY=foo bar&baz`); `set -a; . ./.env` then makes bash try to **execute** the fragment, and the `guard-env-reads` hook blocks the source outright to keep those fragments out of the transcript. When the source is skipped, the consumer (a dev server, a bin tool) silently runs with the wrong env. So the plugin's bin tools load env files with a **dotenv-style parser** (`bin/lib/env-files.mjs`), never `source`: the dev-server boot uses `bin/boot-dev-server.mjs` (see `env-lifecycle.md`), and `bin/e2e-{session-probe,login,session-sync}.mjs` self-load `.env`+`.env.e2e` from `UI_WORKTREE` at startup. The Playwright process itself loads via `playwright.config.ts` (`import 'dotenv/config'` or `npx dotenv -e .env -e .env.e2e`) — also a parser, not a shell.

### Build-time env is baked at dev-server start — `.env.e2e` must be *injected*, not just present

The block above loads `.env.e2e` into the **Playwright** process. That is enough for *runtime*
config the test harness reads (`E2E_BASE_URL`, `E2E_STORAGE_STATE`, credentials). It is **not**
enough for the **frontend bundle** the browser loads. A Vite/Nx frontend inlines its public env
(`NX_*`, `VITE_*`, `NX_PUBLIC_*`) into the served JavaScript **at dev-server start** via the build
config's `define` block, reading from `process.env` (seeded by `dotenv.config()`, which loads only
`.env` / `.env.local` — **never `.env.e2e`**). So a `.env.e2e` override of a build-time var (e.g.
`NX_REACT_APP_DASHBOARD_SERVER_BASE`, which `login v2` POSTs to, or `VITE_TURNSTILE_ENABLED`) takes
effect **only** when the dev server is launched with `.env.e2e` already sourced into its
environment. `dotenv.config()` does not overwrite an already-set `process.env` value, so exporting
the overlay before launch (the boot launcher does `set -a; . ./.env; . ./.env.e2e; set +a`) wins.

Consequence: a **reused** dev server — most often a developer's own `yarn dev`, which sourced only
`.env` — has already baked the app's `.env` (production URLs, real Turnstile) and silently ignores
a correct `.env.e2e`. The login then POSTs to prod and is rejected (HTTP 422 / Turnstile). For this
reason the orchestrator **always boots a frontend fresh, never reuses one** (see `env-lifecycle.md`
boot()) — only a fresh boot guarantees the bundle baked the E2E config. To point a local frontend's
login at the local backend, set `NX_REACT_APP_DASHBOARD_SERVER_BASE` (and any sibling auth bases)
to `localhost` and `VITE_TURNSTILE_ENABLED=false` in `.env.e2e`; the fresh boot does the rest.

## Required env vars

The Playwright run refuses to start unless these are set:

| Variable | Purpose | Example |
|----------|---------|---------|
| `E2E_BASE_URL` | `playwright.config.ts` `use.baseURL`. All `page.goto('/x')` calls are resolved against it. **Must be declared in `.env.e2e`** (see below). | `http://localhost:3000` |
| `E2E_STORAGE_STATE` | Path (worktree-relative or absolute) to the Playwright storageState the suite and the auth gate read/write. Lives under `.auth/` (gitignored). Consumed by `playwright.config.ts` and by `bin/e2e-session-probe.mjs` / `bin/e2e-login.mjs`. | `e2e/.auth/user.json` |

### `E2E_BASE_URL` must come from `.env.e2e` — never `.env`

The app's own `.env` typically points at production (`apps.jelou.ai`, `workflows.jelou.ai`). To guarantee the E2E target is a deliberate choice and never inherited from the app config, `/jlu-ui-qa-run` requires `E2E_BASE_URL` to be declared in the E2E-specific `.env.e2e` overlay:

```bash
[ -f .env.e2e ] || { echo "ERROR: .env.e2e missing"; exit 2; }
grep -qE '^[[:space:]]*E2E_BASE_URL=' .env.e2e || { echo "ERROR: .env.e2e must declare E2E_BASE_URL"; exit 2; }
```

Loading order is unchanged (`.env` then `.env.e2e` overlay) — only the *source* of `E2E_BASE_URL` is constrained. Per-flow vars may still live in either file.

### Target classification (safe vs prod)

After resolving `E2E_BASE_URL`, the workflow classifies it with `bin/classify-e2e-target.mjs <url>`, which prints `safe` or `prod`. The rule is **default-deny**: a host is `safe` only when it is obviously non-production —

- host is `localhost`, `127.0.0.1`, `::1`, or ends in `.local`; or
- a host segment (bounded by start/end or `.`/`-`) is one of `staging`, `dev`, `sandbox`, `qa`, `test`.

Everything else — including `apps.jelou.ai` and `workflows.jelou.ai` — and any unparseable/empty input classifies as `prod`. A `prod` target aborts the run (exit 2) unless `--allow-prod-target` is passed.

#### `localhost` vs `127.0.0.1` — prefer the hostname the auth backend allowlists

Both classify as `safe`, but they are **different browser origins** for CORS. When the app's auth backend (e.g. `dashboard-server`) only allows `http://localhost:<port>` in its CORS allowlist, a login POST from `http://127.0.0.1:<port>` is blocked (`net::ERR_FAILED`, no readable response) and the OTP step never fires — the run dead-ends with no clear error. Set `E2E_BASE_URL` to whichever hostname the auth backend accepts. Default to `localhost` unless you know the backend allowlists the IP form. (Observed 2026-06-07: the datum login dead-ended on `127.0.0.1` and worked verbatim on `localhost`.)

Per-flow vars are declared in the flow's `Env Vars` section (`user-flow.md`). The writer agent reads that section and the orchestrator validates each is set in the loaded environment before launching Playwright. Missing vars fail-fast with the variable name, not a cryptic 404 mid-run.

`TEST_EMAIL` / `TEST_PASSWORD` (used by the `storageState` fallback in `auth-fixtures.md`) are required only when the consumer's auth path uses the fallback; the default programmatic-login fixture does not need them.

## Local cookie-guard session provisioning (optional)

When the target is loopback and a flow routes through a local gateway whose downstream
service validates `sessionId` against local Mongo, step 14c (`bin/e2e-session-sync.mjs`)
provisions the session and copies `jelou_auth` onto the `localhost` host. It auto-detects
and is a no-op otherwise. See `auth-fixtures.md` § "Local cookie-guard session provisioning".

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `COOKIE_SECRET` | for the feature | — | AES-256-GCM key material; must match the backend that issued the cookie |
| `SESSION_SYNC_MONGO_URI` | no | `mongodb://127.0.0.1:27017` | local Mongo connection |
| `SESSION_SYNC_DB` | no | `logsM` | db the validating service reads |
| `SESSION_TTL_HOURS` | no | `12` | `userSessions.expiredAt` lifetime; clamped to a minimum of 1 |
| `SESSION_COOKIE_NAME` | no | `jelou_auth` | auth cookie name |
| `JLU_MONGODB_MODULE` | no | — | explicit path to an installed `mongodb` package if auto-resolve fails |

These are sourced with the rest of the E2E env (`set -a; . ./.env; . ./.env.e2e; set +a`);
`COOKIE_SECRET` is never printed (`guard-env-reads` still applies).

## `playwright.config.ts` requirements

Consumer-owned, but must satisfy the shape below. Load the env either with `import 'dotenv/config'` at the top of the config, or by running Playwright via `npx dotenv -e .env -e .env.e2e -- playwright test ...`. `requireEnv` throws when the variable is unset, so a missing `E2E_BASE_URL` fails at config load rather than mid-run:

```ts
import 'dotenv/config';

export default defineConfig({
  use: {
    baseURL: requireEnv('E2E_BASE_URL'),
  },
});

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
```

The writer agent reads `playwright.config.ts` and refuses with `STATUS: NEEDS_CONTEXT` when `baseURL` is hard-coded to a literal URL.

## Boot vs point-at-existing

For every backend the UI talks to during a flow, choose exactly one:

1. **Boot it locally via `Service Boot Order`.** The service appears in the flow's `Service Boot Order`, has a `dev` block in `services.yaml`, and is launched by `/jlu-ui-qa-run` Phase 3. This is the default for services in `affected_services`.

2. **Point at a real existing endpoint via `.env`.** The service URL is read from a declared env var (e.g., `BILLING_API_URL`, `AUTH_URL`). The orchestrator HEAD-checks each declared external URL during pre-flight and refuses to start if any is unreachable. Use this for upstreams the task does not own (sandboxes, staging, third-party APIs with test modes).

**Forbidden:** mocking the backend with `page.route(...).fulfill(...)` so the test passes without ever touching it. See `e2e-anti-patterns.md` #11.

## What you may intercept (narrow exception)

`page.route()` is allowed only for non-product traffic — analytics beacons, telemetry pixels, marketing widgets — that:

- Is not part of the flow under test.
- Genuinely has no test mode (you tried, document why).
- Is listed in the flow's `Out of Scope` section so reviewers see it at spec time, not test-review time.

Allowed pattern — abort (never fulfill) so the dropped analytics doesn't pollute the network log:

```ts
await page.route('**/segment.io/**', route => route.abort());
await page.route('**/google-analytics.com/**', route => route.abort());
```

Disallowed pattern — fabricating a business response:

```ts
await page.route('**/api/orders', route =>
  route.fulfill({ status: 200, body: JSON.stringify({ id: 1 }) }),
);
```

If you find yourself wanting to fulfill a business endpoint, the right answer is one of:

- Boot the upstream service in `Service Boot Order`.
- Point at a sandbox via `.env`.
- Add a `/api/test/seed` endpoint to the upstream so the test can drive it deterministically through the real contract.

## Dependencies outside the task

When the UI calls a service that is not in `affected_services`:

- The URL must come from `.env` (variable name declared in the flow's `Env Vars` section).
- The orchestrator HEAD-checks each such URL once during pre-flight. Unreachable → exit 2 with `BLOCKED, reason: external_dependency_unreachable: <var-name>=<url>`.
- The user is responsible for ensuring the target accepts test traffic (sandbox tenant, test-only feature flag, isolated org id). The plugin does not enforce this — it only enforces "don't fake it".

If a dependency genuinely cannot be reached during E2E (e.g., a partner API with no sandbox), the flow declares the dependency in `Out of Scope` and the affected steps are pushed to a separate manual QA pass. The writer agent does not silently insert a `page.route()` to compensate.

## Concurrent run safety

For services with `dev.data_isolation: shared` (per `dev-block-schema.md`), `--allow-shared-data` is required. For external endpoints declared via `.env`, the consumer is responsible for run isolation (per-run org id, test tenant, etc.). The plugin does not partition external state.

## See also

- `jelou/references/e2e-anti-patterns.md` — #11 forbids `page.route().fulfill()` of business endpoints.
- `jelou/references/auth-fixtures.md` — credential security contract; uses `process.env.LOGIN_URL` and friends.
- `jelou/references/dev-block-schema.md` — `env_files` declares which files the orchestrator sources before launching non-Docker dev servers.
- `jelou/templates/spec-templates/user-flow.md` — `Env Vars` section that the writer reads and the orchestrator validates.
- `jelou/workflows/ui-qa-run.md` — Phase 3 step 15 implements the `.env` source + var-existence check.

## Backend E2E (production-like)

`/jlu-production-like` runs a dedicated backend E2E phase that does NOT use the dev-block boot
for its dependencies. Instead it brings up **dependencies only** (DB/Redis/etc.) via
Testcontainers in ephemeral, isolated containers, runs the service under test **on the host**
pointed at those containers, and exercises it over real HTTP. Suites live in the E2E path
(`test/e2e/**`, `*.e2e-spec.ts`) — the single place Testcontainers is permitted. Concurrency is
capped to `WORKERS` (default 1) with mandatory dependency-set teardown between services
(`jelou/references/subagent-base.md`, `Test Execution Resource Limits`). This is additive: the
unit+integration `/jlu-test-suite` run against the booted live stack is preserved.
