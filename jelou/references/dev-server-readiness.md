# Dev Server Readiness Signals

> Per-stack guidance for filling in the `dev.ready_signal` (or `dev.health_url`) field of `services.yaml` for jelou-ui-qa orchestration. The values here are starting points, not absolutes — verify on the consumer's actual project before pinning.

## Why this matters

The orchestrator (M2 `/jlu-ui-qa-run`) waits for each service's readiness signal before booting the next one (Premise 2: selective + sequential + health-gated). A wrong signal causes one of:

- **False ready:** the orchestrator moves on too early, the next service tries to connect, gets ECONNREFUSED, the run aborts.
- **False not-ready:** the orchestrator times out while the service is actually fine, and `ready_timeout_s` fires.

Both look like flake. Get the signal right.

## Per-stack defaults

### Next.js (dev mode)

```yaml
dev:
  launcher: npm
  command: npm run dev
  teardown: pkill -f 'next dev'
  ready_signal:
    type: stdout_match
    pattern: "✓ Ready in"
    port: 3000
  ready_timeout_s: 90  # cold compile is slow
  ram_estimate_mb: 600
```

The "✓ Ready in" line appears AFTER the first compile finishes. On cold cache, that can take 30-60s. Don't use `port_open` — Next dev opens the port early and serves a "compiling..." page that is not actually ready for tests.

### Vite

```yaml
dev:
  launcher: npm
  command: npm run dev
  teardown: pkill -f 'vite'
  ready_signal:
    type: stdout_match
    pattern: "Local:"   # Vite prints "  Local:   http://localhost:5173/"
    port: 5173
  ready_timeout_s: 30
  ram_estimate_mb: 400
```

Vite is fast; `Local:` fires reliably at the moment the server is listening.

### Webpack Dev Server (Vue CLI, CRA legacy)

```yaml
dev:
  launcher: npm
  command: npm run serve     # or `npm start` for CRA
  teardown: pkill -f 'webpack-dev-server'
  ready_signal:
    type: stdout_match
    pattern: "Compiled successfully"
    port: 8080
  ready_timeout_s: 90
  ram_estimate_mb: 600
```

CRA's "Compiled successfully" only fires after the first build. Don't trust the "Starting the development server..." line.

### Express (Node, no framework)

```yaml
dev:
  launcher: npm
  command: npm run dev      # whatever the consumer's script is
  teardown: pkill -f 'node.*src/server'
  health_url: http://localhost:3001/health
  ready_timeout_s: 15
  ram_estimate_mb: 200
```

Express has no standard ready signal. Insist on a `/health` endpoint in the consumer service. If the consumer can't add one, fall back to:

```yaml
  ready_signal:
    type: port_open
    port: 3001
  ready_timeout_s: 15
```

`port_open` is acceptable here because Express opens the port only when it's actually ready to handle requests — unlike Next.js.

### NestJS

```yaml
dev:
  launcher: npm
  command: npm run start:dev
  teardown: pkill -f 'nest start'
  health_url: http://localhost:3000/health
  ready_timeout_s: 60        # NestJS startup is slower than Express
  ram_estimate_mb: 350
```

NestJS apps usually expose `/health` via `@nestjs/terminus`. If the consumer doesn't have it set up, the implementer adds it during GREEN — it's a 5-line change.

### NestJS in an idle dev container (`launcher: docker-exec`)

The common Jelou backend pattern: `Dockerfile.dev` ends in `CMD sleep infinity`, the source is
volume-mounted, and the dev server is started **inside** the already-running container. Use
`docker-exec`, not `docker` (which would only `up -d` the idle container and never start the app).

```yaml
dev:
  launcher: docker-exec
  docker:
    service: app
    compose_file: docker-compose.yml
  command: npm run start:dev        # detected from the lockfile — NOT assumed (yarn ≠ npm)
  teardown: docker compose -f docker-compose.yml exec -T app pkill -f 'nest start' || true
  ready_signal:
    type: stdout_match              # checked against the captured exec log
    pattern: "Nest application successfully started"
  ready_timeout_s: 90               # nest start --watch + swc compile is slow on cold cache
  ram_estimate_mb: 350
  data_isolation: none
```

**Why `stdout_match`, not `http_200` on `/`:** a NestJS app with no root controller returns
`404` on `/`, so an `http_200` health check on `/` would *never* pass and the boot would time
out even though the app is up. Match the bootstrap log line instead. `nest start --watch` and
`nest start -b swc -w` both print `[NestApplication] Nest application successfully started`
once the server is listening. (`port_open` also lies here — the container's port is mapped
before the Node process binds it.)

If the app *does* expose a health route, `health_url: http://localhost:<mapped-host-port>/health`
(the **host** port, e.g. `8787`, not the container's `8080`) is the stronger signal.

### Laravel (PHP)

```yaml
dev:
  launcher: shell
  command: php artisan serve --host=0.0.0.0 --port=8000
  teardown: pkill -f 'artisan serve'
  health_url: http://localhost:8000/up
  ready_timeout_s: 20
  ram_estimate_mb: 200
```

Laravel 11+ ships `/up` by default. Older versions need a manual route.

### FastAPI (Python)

```yaml
dev:
  launcher: shell
  command: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
  teardown: pkill -f 'uvicorn app.main'
  health_url: http://localhost:8000/health
  ready_timeout_s: 20
  ram_estimate_mb: 200
```

Add a `/health` route in `app/main.py` if the consumer hasn't already. Stock uvicorn output is noisy; `health_url` is more reliable than `stdout_match`.

### Django

```yaml
dev:
  launcher: shell
  command: python manage.py runserver 0.0.0.0:8000 --noreload
  teardown: pkill -f 'manage.py runserver'
  ready_signal:
    type: stdout_match
    pattern: "Starting development server at"
    port: 8000
  ready_timeout_s: 30
  ram_estimate_mb: 300
```

`--noreload` is intentional: the autoreloader fork can confuse the orchestrator's stdout tail. Tests don't need autoreload.

### Postgres (in Docker)

```yaml
dev:
  launcher: docker
  health_url: http://localhost:5432  # NO — TCP-based check needed
  ready_signal:
    type: port_open
    port: 5432
  ready_timeout_s: 30
  ram_estimate_mb: 250
  data_isolation: per-run
```

Postgres has no HTTP health endpoint. `port_open` is the right signal. If you need a stronger check, use a stack-specific docker healthcheck via `docker-compose.yml`'s `healthcheck:` block and trust `docker compose up --wait`.

### Redis

```yaml
dev:
  launcher: docker
  ready_signal:
    type: port_open
    port: 6379
  ready_timeout_s: 10
  ram_estimate_mb: 50
  data_isolation: per-run
```

## When the consumer has no ready signal at all

If the consumer service prints nothing parseable and exposes no HTTP endpoint:

1. **Add a health endpoint during GREEN** (preferred, 5-10 lines).
2. **Fall back to `type: port_open`** with a longer `ready_timeout_s` and accept the false-ready risk.
3. **Last resort:** wrap the start command in a script that prints a known marker after a short post-start sleep, then `stdout_match` on that marker.

## Tuning `ready_timeout_s`

Start with the per-stack default. If a CI run hits the timeout intermittently, double the value once. If it still flakes, the readiness signal is wrong — switch types rather than keep doubling. False-ready bugs hide in long timeouts.

## Tuning `ram_estimate_mb`

Boot the service alone, run `docker stats <container>` or `ps -o rss= -p $(pgrep -f <command>)` after a minute of idle time. Round up to the nearest 50MB. The pre-flight check sums these; over-estimating slightly is safer than under-estimating.
