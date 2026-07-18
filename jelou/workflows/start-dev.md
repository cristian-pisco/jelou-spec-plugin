# /jlu:start-dev Workflow

> Purpose: Launch all registered services in a TMUX window dedicated to the active task slug.

Inputs:
- `cwd`: the user's current working directory.

## Step 1 — Resolve workspace and config

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/workspace.mjs').then(({ resolveWorkspace }) => {
  process.stdout.write(JSON.stringify(resolveWorkspace(process.argv[1])));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{cwd}"
```

Capture `{ root, configPath, workspaceId }`. If `NO_WORKSPACE`, surface:

> `No workspace root. Run /jlu:register-service first to create jlu-services.json.`

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs').then(({ readConfig }) => {
  process.stdout.write(JSON.stringify(readConfig(process.argv[1])));
}).catch(e => { console.error(e.message); process.exit(2); });
" "{configPath}"
```

If `readConfig` throws (file missing), surface: `No services registered yet. Run /jlu:register-service.` and stop.

## Step 2 — Resolve task slug

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/task-context.mjs').then(({ resolveTaskSlug }) => {
  const slug = resolveTaskSlug({ workspaceRoot: process.argv[1], cwd: process.argv[2] });
  process.stdout.write(slug);
});
" "{root}" "{cwd}"
```

If output starts with `AMBIGUOUS:`, parse the comma-separated list and use `question` (single-choice) to ask the user which task to use. Append `_global` as a "no task" option.

## Step 3 — Verify tmux availability

```bash
tmux -V || echo "TMUX_MISSING"
```

If `TMUX_MISSING`, surface: `tmux is required. Install: brew install tmux (macOS) / apt install tmux (Linux).` Stop.

## Step 4 — Plan the start (dry-run preview)

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/start.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs')
]).then(([s, c]) => {
  const cfg = c.readConfig(process.argv[1]);
  const plan = s.planStart({ config: cfg, workspaceRoot: process.argv[2], slug: process.argv[3] });
  process.stdout.write(JSON.stringify(plan));
});
" "{configPath}" "{root}" "{slug}"
```

Display: window name, layout, list of panes (name + cwd + first 60 chars of command). If `plan.skipped` is non-empty, list those services and the reason.

## Step 5 — Confirm and execute

Use `question` (single-choice): `"Start dev environment in window '{plan.windowName}'?"` with options `start` / `cancel`.

If cancel: print `Cancelled. No changes made.` and stop.

If start, run startDev:

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/start.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs')
]).then(([s, c]) => {
  const cfg = c.readConfig(process.argv[1]);
  const out = s.startDev({
    config: cfg,
    workspaceRoot: process.argv[2],
    slug: process.argv[3],
    env: process.env
  });
  process.stdout.write(JSON.stringify(out));
});
" "{configPath}" "{root}" "{slug}"
```

## Step 6 — Report

Capture the JSON output.

- If `status: "tmux-missing"`, that should already have been caught at Step 3; surface as an error.
- If `status: "exists"`, ask via `question`: `"Window '{name}' already exists. (a) reuse and exit, (b) kill-and-restart, (c) cancel"`. On (b), kill the window via Bash (`tmux kill-window -t <name>`) and re-run Step 5.
- If `status: "created"`, print: `Started <paneCount> services in TMUX window '<windowName>' (layout: <layout>). Daemon will be wired in Phase 3.`

If `skipped` is non-empty, list the skipped services with reasons.

## Notes

- Phase 2 deliberately does NOT spawn a daemon. The `daemonSpawn` callback in `startDev` defaults to a stub returning `{ pid: 0 }`. Phase 3 will wire in the real daemon.
- Use `/jlu-start-dev` in messages (works for both runtimes).
- If the user is not inside tmux, the orchestrator creates a default `jlu-dev` session. The user may need to `tmux attach -t jlu-dev` afterwards.

## Task-aware Jelou-stack boot (--jelou-stack)

> Purpose: boot the registered Jelou backend services as per-task, per-service docker containers keyed by the active task slug — each service gets its own compose project (`<service>-<slug>`), its own allocated host ports, and peer env wiring — instead of the generic tmux pane path above. Use this path when the user passes `--jelou-stack` (or equivalent) to `/jlu:start-dev`, or asks to boot the Jelou backend stack for the current task.

This path reads from the canonical registry at `{plugin-root}/jelou/references/jelou-stack.json`, not from `jlu-services.json`. It does not touch tmux.

### Step A — Resolve the task slug and worktree paths

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/task-context.mjs').then(({ resolveTaskSlug }) => {
  const slug = resolveTaskSlug({ workspaceRoot: process.argv[1], cwd: process.argv[2] });
  process.stdout.write(slug);
});
" "{root}" "{cwd}"
```

If the output starts with `AMBIGUOUS:`, prompt the user the same way as Step 2 of the generic path above.

Build `worktreePaths` — a plain object mapping each registry service `name` to the absolute path of its worktree for this slug, for services that have one (`<serviceRepoPath>/.worktrees/<slug>`, when that directory exists). Services with no worktree for this slug are omitted; if none of the registered services have a worktree for this slug, `worktreePaths` is `{}`.

### Step B — Boot the stack via the adapter

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/boot-runtime.mjs').then(async ({ bootBackendStack }) => {
  const fs = await import('node:fs');
  const slug = process.argv[1];
  const worktreePaths = JSON.parse(process.argv[2]);
  const readEnv = (svc, cwd) => {
    const p = cwd + '/.env';
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };
  const sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const result = await bootBackendStack({
    registryPath: '{plugin-root}/jelou/references/jelou-stack.json',
    slug,
    worktreePaths,
    readEnv,
    fetchImpl: fetch,
    sleepImpl
  });
  process.stdout.write(JSON.stringify(result));
}).catch((e) => { console.error(e.message); process.exit(2); });
" "{slug}" '{worktreePathsJson}'
```

`{worktreePathsJson}` is the JSON-stringified `worktreePaths` object built in Step A.

### Step C — Report

Capture the JSON `{ green, down, services }` result.

- If `green` is `true`: list every service in `services` with its allocated primary host port (`services[].host`, the port `bootStack` resolved from the `primary: true` entry in that service's port list). Report as: `<service>: http://localhost:<host>`. The full per-port list for a service is available at `services[].ports`, if needed.
- If `down` is non-empty: for each down service, surface its container logs by running (a shell command, not node):

  ```bash
  docker exec <service>-<slug> tail -n 30 /tmp/<service>-<slug>.dev.log
  ```

  (the container name and log path both follow the `<service>-<slug>` project-name convention used by the stack). Print the tail output for each down service so the failure is visible before reporting the overall boot as failed.

### Precondition — base images

This path assumes the Jelou dev containers' base images already exist (idle images that `sleep infinity` until a command is exec'd into them). If a per-task container cannot be created because its base image was never built, treat that as a one-time local setup precondition to report to the user — do not attempt to auto-build the image.

### Step D — Allocate frontend + inject host ports

Once the backend boot report is green, collect the host ports already in use: every `services[].host` and every `services[].ports[].host` from the Step B/C result. Union them into a single `occupied` set.

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/ports.mjs').then(({ allocateHostPorts }) => {
  const occupied = new Set(JSON.parse(process.argv[1]));
  const frontend = allocateHostPorts({ mappings: [{ internal: 0 }], occupied, basePort: process.argv[2] })[0].host;
  occupied.add(frontend);
  const inject = allocateHostPorts({ mappings: [{ internal: 0 }], occupied, basePort: process.argv[3] })[0].host;
  process.stdout.write(JSON.stringify({ frontendPort: frontend, injectPort: inject }));
});
" '{occupiedPortsJson}' '{registry.frontend.port}' '{registry.authInjectPort}'
```

Also build `hostByService` — a plain object mapping each Step B/C `services[].name` to its `services[].host` — reused by every step below.

### Step E — Rewrite the frontend `.env`

Back up `<frontend.path>/<frontend.envFile>` to `<frontend.path>/<frontend.envBackup>` (registry `frontend.envBackup`) if that backup does not already exist. Read the current `.env` contents (empty string if the file is absent), then:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/frontend-env.mjs').then(({ rewriteFrontendEnv }) => {
  const out = rewriteFrontendEnv({
    envText: process.argv[1],
    envLocal: JSON.parse(process.argv[2]),
    envBlank: JSON.parse(process.argv[3]),
    hostByService: JSON.parse(process.argv[4])
  });
  process.stdout.write(out);
});
" "{currentEnvText}" '{registry.frontend.envLocalJson}' '{registry.frontend.envBlankJson}' '{hostByServiceJson}'
```

Write the result back over `<frontend.path>/<frontend.envFile>`.

### Step F — Boot Vite on the host

From `<frontend.path>`, run `<frontend.command> --port <frontendPort> --strictPort` in the background, redirecting stdout/stderr to a runtime log file. Poll `http://localhost:<frontendPort>/` until it answers an HTTP request — Vite's first compile typically takes 30–90s, so re-poll roughly every 15s rather than failing fast.

### Step G — Login for the auth cookie

Read `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` from `<auth.credentials.envFile>` — never print these values or the resulting cookie. Resolve the auth URLs, then perform the login:

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/auth-urls.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/login-cookie.mjs'),
  import('{plugin-root}/bin/lib/dev-orchestrator/stack/auth-runtime.mjs')
]).then(async ([{ resolveAuthUrls }, { loginForCookie }, { postJson, readOtpFromRedis }]) => {
  const auth = JSON.parse(process.argv[1]);
  const hostByService = JSON.parse(process.argv[2]);
  const { loginUrl, verifyMfaUrl, cookieName } = resolveAuthUrls({ auth, hostByService });
  const result = await loginForCookie({
    loginUrl, verifyMfaUrl, cookieName,
    email: process.argv[3], password: process.argv[4],
    postJson,
    readOtp: readOtpFromRedis(auth.otpFallback)
  });
  process.stdout.write(JSON.stringify({ status: result.status }));
});
" '{registry.authJson}' '{hostByServiceJson}' "{email}" "{password}"
```

Capture the cookie value out-of-band (never echoed to stdout/logs). If `status` is not `ok`, map the cause and stop before touching the browser: `rejected` → bad credentials or an inactive account; `otp-missing` → no OTP found at the configured Redis key; `otp-rejected` → the OTP was read but the dashboard rejected it.

### Step H — Inject the cookie and open the browser

Start the inject server:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/stack/inject-page.mjs').then(({ renderInjectPage, startInjectServer }) => {
  const page = renderInjectPage({
    cookieName: process.argv[1],
    cookieValue: process.argv[2],
    appUrl: process.argv[3],
    account: process.argv[4]
  });
  startInjectServer({ port: Number(process.argv[5]), page });
});
" "{cookieName}" "{cookieValue}" "http://localhost:{frontendPort}/" "{email}" "{injectPort}"
```

Then, using `mcp__chrome-devtools__*`: `navigate_page` to `http://localhost:<injectPort>/`, `wait_for` the app to render, and if the page is blank reload once (Vite's cold-cache re-optimization can stall the first hit). Confirm the session is authenticated via `take_snapshot` — the URL must not be `/login` and real app content must be present — then close out with `take_screenshot`. Never print the cookie value in any tool output or report.

### Step I — Verify

For each URL in `resolveAuthUrls({ auth, hostByService }).verifyUrls`, issue a request with header `Cookie: <cookieName>=<cookieValue>` and confirm a `200` response. Only declare auth green once every verify URL passes.

### Notes — frontend + auth

- **Browser MCP override.** This path drives the browser exclusively through `mcp__chrome-devtools__*`. That is a deliberate, standing override of the global "use `/browse` for all web browsing" preference — the preference concerns the separate `mcp__claude-in-chrome__*` MCP and does not apply to this local-stack auth path, per the same override documented by the `jelou-local-stack` skill.
- **OTP key mismatch (informational).** `bin/lib/api-login.mjs`'s own CLI path uses `mfa-code-<email>` as the Redis key, while this path reads the registry's `auth.otpFallback.keyPrefix` (`2fa-code-`), per `jelou-local-stack`. The configured E2E account has 2FA disabled, so the OTP branch is normally never exercised — if 2FA is ever armed on that account, confirm which key prefix the auth-service actually writes before trusting `readOtpFromRedis`.
