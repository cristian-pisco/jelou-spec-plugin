# Sample Consumer

A tiny stdlib-only API plus a Playwright project that exercises the `/jlu-ui-qa-run` flow end-to-end in CI. Used by `.github/workflows/test.yml` and as a local sandbox for dogfooding M1/M2/M3.

## Layout

```
sample-consumer/
├── docker-compose.yml          # boots the api container (forwards BUG_MODE for the fix-loop CI flow)
├── api/                        # tiny node:http service: /health, /api/test/{seed,login}, /api/subscriptions/{me,cancel}, plus / and /dashboard HTML
│   ├── package.json
│   ├── Dockerfile
│   └── src/index.mjs
└── frontend/                   # Playwright-only — no separate UI framework (the API serves the HTML inline)
    ├── package.json            # @playwright/test pinned to 1.49.1 (matches bin/extract-trace.mjs's trace.zip schema)
    ├── playwright.config.ts    # baseURL points at the api container (http://localhost:4001)
    └── tests/e2e/
        ├── cancel-flow.spec.ts
        └── fixtures/auth.ts    # signInAs(page, request, email) — seeds + logs in via /api/test/*
```

## Why no Next.js / Vite

The original design called for a Next.js app, but the real-world contract this fixture exercises is just *can the consumer run a Playwright suite against a backed-by-API flow*. A separate frontend would add ~30s of npm install per CI run for no extra coverage. The API serves a minimal `/dashboard` HTML that triggers the same network shape — same trace, same assertion, faster CI.

## Two CI flows (`.github/workflows/test.yml`)

### `Sample-consumer E2E (happy path)` — runs on every push and PR

1. `docker compose up -d --wait api`
2. `cd frontend && npm ci && npx playwright install --with-deps chromium`
3. `npx playwright test --reporter=line` → green

### `Sample-consumer E2E (deliberate bug surfaces in trace)` — runs on PRs only

Same as happy-path, but with `BUG_MODE=500` exported so the API returns 500 from `/api/subscriptions/cancel`. Asserts:
- The Playwright suite exits non-zero.
- `bin/extract-trace.mjs` surfaces `"status": 500` in the resulting summary, exercising the M3 fix-loop's trace-reading path.

## Running locally

```bash
# Boot the api container
cd tests/sample-consumer
docker compose up -d --wait api

# Run the happy-path suite
cd frontend
npm install
npx playwright install --with-deps chromium
npx playwright test

# Run the deliberate-bug variant
docker compose down -v
BUG_MODE=500 docker compose up -d --wait api
cd frontend && npx playwright test --trace=on    # expected to fail; trace.zip captured

# Tear down
cd .. && docker compose down -v
```

## What's NOT here

- A full Postgres setup. The api uses an in-memory store to keep CI fast (~30s instead of 90s).
- Real auth via JWT. `/api/test/login` mints an opaque cookie value; production consumers replace this with their real auth.
- Visual regression. Out of scope for v0.1.0.
