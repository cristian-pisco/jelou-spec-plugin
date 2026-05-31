# ui-qa-run: E2E environment opt-in + Playwright bootstrap

**Date:** 2026-05-31
**Status:** Design approved, pending implementation plan
**Scope:** `jelou/workflows/ui-qa-run.md`, `agents/jlu-ui-e2e-writer.md`, `jelou/references/e2e-environment.md`, `bin/classify-e2e-target.mjs` (new), `tests/unit/classify-e2e-target.test.mjs` (new)

## Problem

Running `/jlu-ui-qa-run` against `jelou-apps` returns `BLOCKED`. Two distinct gaps surface:

1. **No Playwright infrastructure.** `jelou-apps` ships a Vitest suite (`libs/builder/src/e2e`, `workflow.spec.js` with ReactFlow mocks), not Playwright. The workflow hard-assumes `npx playwright test` (Phase 3 step 15) and the writer agent escalates `BLOCKED` when "the consumer service has no Playwright config and the orchestrator did not provide a default." There is no path from "no infra" to "running suite" — it is a dead end.

2. **`.env` points at production.** `jelou-apps`'s `.env` resolves to `apps.jelou.ai` / `workflows.jelou.ai`. The current contract (`e2e-environment.md`) requires `E2E_BASE_URL` but does **not** forbid it resolving to prod, nor does it structurally separate the E2E target from the app's own `.env`. A run could silently exercise production with real operator auth.

Both gaps must be closed **without weakening the standing principle that E2E is mandatory for any frontend change.** The fix turns dead-ends into actionable paths; it never turns a missing gate green.

## Goals

- Make the E2E target a **deliberate, opt-in choice** — never production by accident.
- When a UI service lacks Playwright infra, **offer to scaffold it** (config + auth fixture stub + dependency) instead of refusing outright.
- Preserve "E2E mandatory for frontend changes": every new failure path ends in `BLOCKED` (exit 2), never a silent skip or a false green.

## Non-goals

- Changing the existing "UI service missing `dev` block" hard error (Phase 1 step 6 / Phase 2 step 11). That gate is orthogonal — it governs how to *boot* the service, not the test runner — and stays exactly as is.
- Writing UI implementation code, auth wiring, or `data-testid` attributes (still forbidden — the implementer owns those).
- Migrating or touching the existing Vitest suite in `jelou-apps`.
- Partitioning external/shared state (covered by `--allow-shared-data`, unchanged).

## Design

### Decisions (from brainstorming)

1. **Scaffolding owner:** a new `MODE=bootstrap` inside `jlu-ui-e2e-writer` (reuses its Playwright-convention knowledge; single responsibility boundary).
2. **File ownership:** scaffolded files are **consumer-owned** (written into the UI service worktree; the user commits them to their repo). A confirmation gate runs **before** any write into the real repo. Future runs detect the infra and do not re-scaffold.
3. **Env target opt-in:** `E2E_BASE_URL` **must** come from `.env.e2e` (not `.env`), **plus** an anti-prod heuristic that blocks production-looking targets unless `--allow-prod-target` is passed.
4. **Decline/failure behavior:** always `BLOCKED` (exit 2) with actionable instructions. Never green, never skip.

### Component overview

| Component | Change |
|---|---|
| `jelou/workflows/ui-qa-run.md` | New flag `--allow-prod-target`; new step 11b "Playwright infra check + bootstrap gate"; reinforced step 15 env loading; new failure-mode rows |
| `agents/jlu-ui-e2e-writer.md` | New `MODE=bootstrap` that scaffolds infra, then falls through to `derive-from-spec` |
| `jelou/references/e2e-environment.md` | Contract: `E2E_BASE_URL` must be declared in `.env.e2e`; target classification (safe vs prod) |
| `bin/classify-e2e-target.mjs` (new) | Testable anti-prod heuristic: URL → `safe` \| `prod` |
| `tests/unit/classify-e2e-target.test.mjs` (new) | Unit coverage for the heuristic |
| `.opencode/agents/jlu-ui-e2e-writer.md` | Regenerated via `bin/sync-agents.mjs` (never hand-edited) |

### 1. Environment contract (opt-in, never prod by default)

Enforced in `e2e-environment.md` and `ui-qa-run.md` Phase 3 step 15.

**`.env.e2e` mandatory for `E2E_BASE_URL`.** Today `.env` then `.env.e2e` are both sourced and `E2E_BASE_URL` may come from either. New rule — the runner requires `.env.e2e` to exist and declare `E2E_BASE_URL` explicitly:

```bash
[ -f .env.e2e ] || {
  echo "ERROR: .env.e2e missing. E2E never runs with the app's .env config."
  echo "  Create .env.e2e and set E2E_BASE_URL. See references/e2e-environment.md."
  exit 2
}
grep -qE '^[[:space:]]*E2E_BASE_URL=' .env.e2e || {
  echo "ERROR: .env.e2e must declare E2E_BASE_URL explicitly."
  exit 2
}
```

This guarantees the E2E target is a deliberate decision, not inherited from a production `.env`. Loading order is unchanged (`.env` then `.env.e2e` overlay) so per-flow vars still fall through; only the *source* of `E2E_BASE_URL` is constrained.

**Anti-prod classification.** After resolving `E2E_BASE_URL`, the workflow calls:

```bash
TARGET_CLASS=$(node "$PLUGIN_ROOT/bin/classify-e2e-target.mjs" "$E2E_BASE_URL")
if [ "$TARGET_CLASS" = "prod" ] && [ -z "$ALLOW_PROD_TARGET" ]; then
  echo "ERROR: E2E_BASE_URL points at production ('$E2E_BASE_URL')."
  echo "  Pass --allow-prod-target if this is intentional."
  exit 2
fi
```

`bin/classify-e2e-target.mjs` prints `safe` or `prod`. **Default-deny:** a host is `safe` only when it is obviously non-production:

- host is `localhost`, `127.0.0.1`, `::1`, or ends in `.local`; OR
- host contains one of `staging`, `dev`, `sandbox`, `qa`, `test`.

Everything else — including `apps.jelou.ai` and `workflows.jelou.ai` — classifies as `prod`. Invalid or empty input classifies as `prod` (fail-safe). The override is the `--allow-prod-target` flag (deterministic, consistent with the existing `--force` / `--allow-shared-data` / `--allow-test-edits` idiom).

### 2. `MODE=bootstrap` in `jlu-ui-e2e-writer`

The agent gains a third mode. Mode ordering: `bootstrap` → scaffolds infra → falls through to `derive-from-spec` (which generates `user-flow.md` and the `*.spec.ts` files).

**Human confirmation lives in the orchestrator, not the writer.** The writer's tools are `Read, Write, Bash, Glob, Grep, context7` — it has no `AskUserQuestion`. The orchestrator (`ui-qa-run.md`, which does have `AskUserQuestion`) obtains confirmation *before* dispatching. So a `MODE=bootstrap` dispatch means consent has already been granted.

When dispatched with `MODE=bootstrap`, the writer:

1. Writes `tests/e2e/playwright.config.ts` with:
   - `import 'dotenv/config'` (or the `npx dotenv -e .env -e .env.e2e --` runner pattern),
   - `use.baseURL: requireEnv('E2E_BASE_URL')` (throws when unset — matches the existing config contract),
   - `testDir: 'tests/e2e'` — a dedicated directory that does **not** collide with the existing Vitest suite at `libs/builder/src/e2e`.
2. Writes an auth fixture stub at `tests/e2e/fixtures/auth.ts` exporting `signInAs(...)` with a clear `// implementer must wire this up during GREEN` marker.
3. Detects the package manager from the lockfile (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm), adds `@playwright/test` to `devDependencies`, runs the matching install plus `npx playwright install chromium`.
4. **Idempotency:** if `playwright.config.{ts,js}` already exists, the writer does **not** overwrite it (consumer-owned). It scaffolds only what is absent.
5. Falls through to the existing `derive-from-spec` logic.

The agent's `Outputs` / "You do NOT write `playwright.config.ts`" clause is updated to carve out the `bootstrap` exception: it writes the config **only** in `bootstrap` mode, **only** when absent, into a dedicated `tests/e2e/` dir.

**Run-command implication.** Phase 3 step 15 currently runs `npx playwright test` from `$UI_WORKTREE` with config auto-discovery at the worktree root. Because bootstrap writes the config to `tests/e2e/playwright.config.ts` (to avoid colliding with the Vitest suite), the run step must pass `--config tests/e2e/playwright.config.ts` when the bootstrapped config is used. The infra check in step 11b therefore looks for a config at **either** the worktree root **or** `tests/e2e/`, and records which path it found so step 15 can point at it. A pre-existing consumer config at the root is honored as-is (no `--config` override).

### 3. Orchestrator control flow (`ui-qa-run.md`)

New **step 11b**, after step 11 (identify UI services) and before dispatching the writer, per UI service:

```
11b. Playwright infra check:
     Does package.json depend on @playwright/test AND does a
     playwright.config.{ts,js} exist in the worktree?
       YES → normal path (writer in normal / derive-from-spec mode).
       NO  → bootstrap gate (AskUserQuestion):
             "<svc> has no Playwright infrastructure. I will create in your repo:
                - tests/e2e/playwright.config.ts
                - tests/e2e/fixtures/auth.ts
                - add @playwright/test (devDependency) and install it
              Proceed?"
               Declined → exit 2 BLOCKED
                 ("Playwright infra required; E2E is mandatory for frontend changes.")
               Accepted → dispatch writer with MODE=bootstrap.
                 Scaffold/install failure → exit 2 BLOCKED with the manual command.
```

New flag in **Inputs**: `--allow-prod-target` — override the anti-prod target gate (use sparingly).

### 4. Error handling — always BLOCKED, never skip

New rows in the workflow's "Failure modes & UX" table, all exit 2:

| Scenario | Message |
|---|---|
| `.env.e2e` missing | "create .env.e2e with E2E_BASE_URL" + reference |
| `.env.e2e` without `E2E_BASE_URL` | "declare E2E_BASE_URL in .env.e2e" |
| Prod target without override | "E2E_BASE_URL points at production (`<url>`); pass --allow-prod-target if intentional" |
| No Playwright infra + declined bootstrap | "Playwright infra required; E2E mandatory for frontend changes" |
| Bootstrap / install failed | "could not install @playwright/test; run `<cmd>` manually" |

No new path returns 0 or skips. The gate may remain **pending**, but it is never recorded as passed.

### 5. Testing

- `tests/unit/classify-e2e-target.test.mjs` covering:
  - `http://localhost:3000` → `safe`
  - `https://staging.jelou.ai` → `safe`
  - `https://app-dev.jelou.ai` → `safe`
  - `https://apps.jelou.ai` → `prod`
  - `https://workflows.jelou.ai` → `prod`
  - `not-a-url` → `prod` (fail-safe)
  - `` (empty) → `prod` (fail-safe)
- After editing `agents/jlu-ui-e2e-writer.md`: run `node bin/sync-agents.mjs`, then `node bin/sync-agents.mjs --check` must pass (pre-push checklist).
- `npm test` (`node --test tests/unit/*.test.mjs`) must be green before any push to `main`.
- Existing `harness-parity` and `agent-frontmatter` tests continue to cover OpenCode↔Claude parity for the edited agent.

## Data flow

```
/jlu-ui-qa-run [--allow-prod-target]
  └─ resolve slug, workspace, task dir, lock
  └─ read affected_services, services.yaml
  └─ identify UI services (step 11)
       └─ step 11b: Playwright infra present?
            ├─ yes → writer (normal | derive-from-spec)
            └─ no  → AskUserQuestion confirm
                     ├─ decline → BLOCKED (exit 2)
                     └─ accept  → writer MODE=bootstrap
                                    └─ scaffold config + fixture + install
                                    └─ fall through to derive-from-spec
  └─ boot services (step 14)
  └─ env load (step 15):
       ├─ require .env.e2e declares E2E_BASE_URL → else BLOCKED
       ├─ classify-e2e-target.mjs → prod & no --allow-prod-target → BLOCKED
       └─ source .env then .env.e2e; validate required-env.txt
  └─ run Playwright → parse → fix-loop → teardown → report
```

## Open questions

None. All four design decisions resolved during brainstorming.
