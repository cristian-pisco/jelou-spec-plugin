# Sample Consumer

A tiny Next.js + Express app that exercises the full `/jlu-ui-qa-run` flow end-to-end in CI. Used by `.github/workflows/test.yml` and as a local sandbox for dogfooding M1/M2/M3.

## Layout

```
sample-consumer/
├── docker-compose.yml          # boots api + frontend (and a postgres if needed)
├── api/                        # tiny Express service exposing /health, /api/test/seed, /api/test/login, /api/subscriptions/cancel
│   ├── package.json
│   └── src/index.mjs
├── frontend/                   # tiny Next.js app — login → dashboard → cancel flow
│   ├── package.json
│   ├── playwright.config.ts
│   ├── src/app/...
│   └── tests/e2e/fixtures/auth.ts
└── .spec-workspace/            # workspace fixture so /jlu-ui-qa-run has somewhere to read from
    ├── registry/services.yaml
    └── specs/2026-04-25/sample-task/
        ├── SPEC.md
        ├── TASKS.md
        └── selectors.md
```

## Two CI flows

### `happy-path.yml`

1. `docker compose up -d api`
2. `cd frontend && npm ci && npx playwright install --with-deps chromium`
3. `node ../bin/extract-trace.mjs --version`  (smoke test)
4. `node ../tests/pressure/runner.mjs`        (replay-mode pressure tests)
5. `node --test ../tests/unit/*.test.mjs`     (unit tests)
6. The full /jlu-ui-qa-run flow against the sample-consumer is dispatched via Claude Code in a future iteration; for now CI exercises the deterministic checks above.

### `fix-loop-bug.yml`

Same as happy-path, but with a deliberate bug seeded in `frontend/src/app/dashboard/page.tsx` (the cancel banner says the wrong text). Asserts that the M3 fix-loop:
- Identifies the source file responsible.
- Applies one targeted edit.
- Reports `STATUS: DONE`.
- The orchestrator's re-run finds the test green.

## Running locally

```bash
# Boot the consumer
cd tests/sample-consumer
docker compose up -d api
cd frontend && npm ci && npx playwright install --with-deps chromium

# Run the unit tests
cd ../../..
node --test tests/unit/*.test.mjs

# Run the pressure suite (replay mode)
node tests/pressure/runner.mjs

# Tear down
cd tests/sample-consumer && docker compose down
```

## What's NOT here

- A full Postgres setup. The sample uses an in-memory store in `api/src/index.mjs` to keep the CI fast (~30s instead of 90s).
- Full auth via JWT. The sample uses a cookie with a dev-only signed value; production consumers replace this with their real auth.
- Visual regression. Out of scope for v0.1.0.
