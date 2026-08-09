# /jlu:register-service Workflow

> Purpose: Interactively register (or update) a single service in the workspace's `jlu-services.json`.

Inputs:
- `argument`: optional service name. If provided, skip the name prompt and treat it as the target.
- `cwd`: the user's current working directory.

## Step 1 — Resolve workspace and existing config

Run inline (single bash call):
```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/workspace.mjs').then(({ resolveWorkspace }) => {
  const r = resolveWorkspace(process.argv[1], { allowGitFallback: true });
  process.stdout.write(JSON.stringify(r) + '\n');
}).catch(e => { console.error(e.message); process.exit(2); });
" "{cwd}"
```

`allowGitFallback: true` is exclusive to this command: registering the first service is the one moment a workspace legitimately has no marker yet, so falling back to the git toplevel is the intended bootstrap. Every other command resolves strictly and fails with `NO_WORKSPACE` rather than booting against a plausible-but-wrong root.

If the script exits non-zero with `NO_WORKSPACE`, surface this message to the user verbatim and stop:
> `No workspace root found in {cwd}. Run /jlu:register-service from inside a project directory.`

Otherwise capture `{ root, configPath, workspaceId }`.

## Step 2 — Load or init config

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/register.mjs').then(({ loadOrInitConfig }) => {
  process.stdout.write(JSON.stringify(loadOrInitConfig(process.argv[1])) + '\n');
});
" "{configPath}"
```

Capture the parsed config. Note existing service names (used for the next prompt).

## Step 3 — Ask for the service name

Use `question` (single-choice if `argument` is provided and matches an existing service; otherwise free-text):

- Prompt: `"Service name (kebab-case, [a-z0-9-]+)"`
- If `argument` is provided, pre-fill it.
- Validation: must match `^[a-z0-9][a-z0-9-]*$`. If not, re-prompt.

If the name matches an existing service, ask: *"This service is already registered. Update it?"* (yes / cancel).

## Step 4 — Ask for the path

Default = relative path from workspace root to `cwd`. Compute via `path.relative(root, cwd)` (use `.` if equal). Use `question` (free-text with default).

After the user answers, run:
```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/register.mjs').then(({ inferDefaults }) => {
  process.stdout.write(JSON.stringify(inferDefaults(process.argv[1])) + '\n');
});
" "{root}/{path}"
```

Capture `{ packageManager, suggestedCommand, dotEnvFiles, composeFile, composeServices }`.

## Step 5 — Ask for runtime type

Use `question` (single-choice):

- `host` — service runs directly on the host (default if no compose file detected).
- `docker-compose` — service runs inside a Docker Compose container (default if compose file detected).

## Step 6 — If `docker-compose`, ask for compose details

Two `question` calls:

1. `"Compose file path (relative to {root})"` — default = the detected compose file path; free-text.
2. `"Compose service name"` — single-choice from `composeServices` if any were detected; otherwise free-text.

## Step 7 — Ask for command

Use `question` (free-text). Default depends on runtime. **Use the detected package manager
from Step 4 (`inferDefaults.packageManager`) — never hardcode `npm`.** Its run prefix is
`npm run` / `yarn` / `pnpm` / `bun run`; the script name is the service's dev script
(`start:dev` for NestJS, `dev` for Vite/Next). Booting a yarn command on an npm project (or
vice-versa) is a real failure.

- `host`: `suggestedCommand` from inference, or empty.
- `docker-compose`: `docker compose -f {compose_file} up -d && docker compose -f {compose_file} exec {compose_service} {run-prefix} {dev-script}` (use the compose values from Step 6 and the detected package manager). Example for an npm/NestJS service: `… exec app npm run start:dev`.

## Step 8 — Ask for env_file

Use `question` (single-choice + custom):

- Default `.env` if `.env` is present in the dotEnvFiles inference.
- Other detected files (`.env.local`, `.env.development`, etc.) listed as choices.
- Option: `none (null)`.

## Step 9 — Ask for depends_on

Use `question` (multi-choice). Choices = existing service names from the loaded config (excluding the current one). Skip the question if the list is empty.

## Step 10 — Ask for readiness

Use `question` (single-choice):

- `none`
- `http: <url>` — follow-up free-text for the URL. Default = `inferDefaults.suggestedReadinessUrl` if non-null (port detected from `.env`, `package.json` scripts, or `.listen()` calls), otherwise `http://localhost:3000/health`.
- `tcp: <host>:<port>` — follow-up free-text for `host:port`. Default = `localhost:<inferDefaults.detectedPort>` if non-null, otherwise `localhost:3000`.

## Step 11 — Ask for log_failure_patterns

Use `question` (free-text, optional). One regex per line. Empty input = use only the defaults inherited from the global `defaults` block.

## Step 12 — Build the service object and validate

Build the service entry from the answers (omit fields the user left blank/none). Always set
`package_manager` to the manager detected in Step 4 — it is recorded so that later consumers
(dependency installs, `/jlu:autofix`) read it as a fact instead of re-deriving or guessing it.
Omit it only when Step 4 detected none (a non-Node service).

Then validate by writing through:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/register.mjs').then(({ addOrUpdateService }) => {
  const cfg = JSON.parse(process.argv[1]);
  const svc = JSON.parse(process.argv[2]);
  process.stdout.write(JSON.stringify(addOrUpdateService(cfg, svc)) + '\n');
});
" '{cfg-json}' '{service-json}'
```

Then call validateConfig + writeConfigAtomic in one invocation:

```bash
node -e "
Promise.all([
  import('{plugin-root}/bin/lib/dev-orchestrator/config.mjs')
]).then(([m]) => {
  const cfg = JSON.parse(process.argv[1]);
  const v = m.validateConfig(cfg);
  if (!v.valid) { process.stderr.write(v.errors.join('\n') + '\n'); process.exit(2); }
  m.writeConfigAtomic(process.argv[2], cfg);
  process.stdout.write('OK\n');
});
" '{merged-cfg-json}' "{configPath}"
```

If validation fails, surface the errors to the user and ask whether they want to retry the interview (back to Step 3) or cancel.

## Step 13 — Confirm and offer git add

Print a one-line summary:
> `Wrote service "{name}" to {configPath}.`

Use `question` (single-choice): *"Stage `{configPath}` for commit?"* (yes / no).

If yes, run:
```bash
git -C "{root}" add "{configPath}"
```

Print `Staged.` or surface any error.

## Notes

- Always reference the user-facing command as `/jlu-register-service` in messages (works in both runtimes; Claude Code users mentally substitute the colon).
- Never invoke any tmux command in this workflow — that's Phase 2.
- If the user cancels at any prompt, do nothing destructive: leave the existing config untouched and print `Cancelled. No changes made.`.
