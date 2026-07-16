# Playwright Conventions

> Conventions the `jlu-ui-e2e-writer` agent must follow when emitting tests, and the `jlu-ui-fix-loop` agent must respect when reading them. These are not Playwright-the-library docs (use context7 for that); they are the **opinionated subset** jelou-ui-qa enforces.

## Locator priority (mandatory)

Use locators in this order. Drop one tier only when the higher tier genuinely cannot resolve to one element:

1. **`page.getByRole(role, { name })`** — the default. Derives from accessibility semantics, stable across CSS rewrites.
2. **`page.getByLabel(text)`** — for form fields with associated labels.
3. **`page.getByText(text, { exact })`** — for headings, paragraphs, and content text.
4. **`page.getByPlaceholder(text)`** — for inputs without labels (rare; prefer adding a label during GREEN).
5. **`page.getByTestId(id)`** — only when `id` is declared in `selectors.md`. Refuses to invent.

CSS selectors and XPath are forbidden. If you reach for one, you've skipped the discipline of asking "why does this element have no role?" — fix the UI's accessibility instead.

## Auto-wait, never `waitForTimeout`

Playwright's locators auto-wait for elements to be actionable. Never write:

```ts
await page.waitForTimeout(1000);
```

Instead:

```ts
await expect(page.getByRole('button', { name: 'Submit' })).toBeEnabled();
await page.getByRole('button', { name: 'Submit' }).click();
```

The only acceptable use of `waitForTimeout` is in throwaway debug code — never committed to a test file.

## Assertion style — auto-retrying expectations

Assertions that may take time (a heading appears after navigation, a request resolves) MUST use Playwright's auto-retrying matchers:

```ts
await expect(locator).toBeVisible();
await expect(locator).toHaveText('Done');
await expect(page).toHaveURL(/\/dashboard/);
```

A snapshot read does not retry and is flaky — never assert on it:

```ts
const count = await locator.count();
expect(count).toBe(3);
```

Use `await expect(locator).toHaveCount(3)` instead — it auto-waits for the count to settle.

## One behavior per `test()` block (default)

Default to one user behavior per `test()` block. The writer agent emits multiple `test()` blocks when the spec lists independent assertions, and one `test()` with sequential steps when the spec lists a state-sharing flow.

Independent assertions — emit two `test()`s:

```ts
test('shows pro plan badge for paid users', async ({ page }) => { ... });
test('shows free plan badge for unpaid users', async ({ page }) => { ... });
```

State-sharing flow — emit one `test()` with sequential steps:

```ts
test('user cancels subscription and sees confirmation', async ({ page }) => {
  await page.goto('/login');
  await signIn(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Cancel subscription' }).click();
  await expect(page.getByRole('status')).toHaveText('Subscription canceled');
});
```

## Fixtures

- Auth fixtures: see `references/auth-fixtures.md`. Default = programmatic API login. `storageState` only when API login isn't available.
- Test data fixtures: API-driven (POST to `/api/test/seed` or equivalent). Direct DB writes are forbidden — they couple tests to schema changes the spec didn't drive.

## Side-effect assertions

When the spec says "after step N, the database has X" or "an event was published", the test asserts via the consumer service's read API:

Assert through the consumer read API:

```ts
const response = await request.get('/api/subscriptions/me');
const body = await response.json();
expect(body.status).toBe('canceled');
```

Never assert with a direct DB query:

```ts
const rows = await db.query('SELECT * FROM subscriptions WHERE user_id = ...');
```

Why: the spec describes user-facing contract. The DB schema is implementation. When the implementation moves data to a new table, tests written against the API still pass. Tests written against the DB don't.

## File and naming

- One `.spec.ts` per `user-flow.md` block.
- Filename = kebab-case slug derived from the flow's Problem Statement (first 6 words).
- Test description = exact text of the spec's first assertion (so a failing test reads like the spec).
- No file header comment. Generated tests are comment-free; the spec→test mapping is recorded in `INDEX.md` and selector provenance in `selectors-used.txt`, never as a comment in the `.spec.ts`.

## Trace, video, and screenshot policy

- The `playwright.config.ts` `use.trace` is whatever the consumer set; `/jlu-ui-qa-run` additionally forces `--trace=retain-on-failure` at the CLI level so a trace exists on the FIRST failure (no retries are configured, so `on-first-retry` would record nothing and blind the fix-loop).
- **Video is recorded for every run — pass or fail.** Playwright has no `--video` CLI flag, so video cannot be forced like `--trace`; instead `/jlu-ui-qa-run` exports `JLU_E2E_VIDEO` (default `on`, resolved from `~/.jlu/e2e-settings.json`, seeded from `jelou/config/e2e-settings.json` on first use and never clobbered). A consumer `playwright.config.ts` opts in by reading `process.env.JLU_E2E_VIDEO` for its `use.video` — the bootstrap scaffold does this by default; a pre-existing consumer config must add the one-line read to record video (otherwise its own `use.video` wins and passing runs are discarded). The point is to let a human watch what a *passing* test actually exercised, not only failures.
- Videos are written as `.webm` under the run's `playwright-output/` (gitignored, local-only), listed in the run report's artifacts section, and swept by `/jlu-ui-qa-cleanup` after `retentionDays` (from the same settings file).
- On failure, the trace extractor unzips the trace and emits `trace-summary.json` for the fix-loop. Tests don't need to do anything special for this.

## What the writer does NOT do

- Modify `playwright.config.ts` (consumer owns it).
- Add `data-testid` attributes to UI source code (forbidden — the implementer adds them during GREEN, only when listed in `selectors.md`).
- Run tests autonomously (Playwright runs are user-triggered via `/jlu-ui-qa-run`, M2).

## What the fix-loop does NOT do

- Edit test files (forbidden by Premise 5 unless `--allow-test-edits` is set).
- Edit files outside the UI service's worktree (forbidden by Premise 10).
- Re-run tests after modifying `playwright.config.ts` — that's the user's call.
