# E2E Anti-Patterns

> Patterns the `jlu-ui-e2e-writer` agent must NOT emit, and the `jlu-ui-fix-loop` agent treats as a flagged-test signal (the test, not the source, is wrong).

## 1. Testing the mock, not the code

```ts
// ❌
const mockClick = jest.fn();
render(<Button onClick={mockClick} />);
fireEvent.click(screen.getByRole('button'));
expect(mockClick).toHaveBeenCalled();
```

This proves nothing about the user's experience. It proves the test wired up its own mock correctly.

```ts
// ✅
await page.goto('/products');
await page.getByRole('button', { name: 'Add to cart' }).click();
await expect(page.getByRole('status')).toHaveText('Added to cart');
```

E2E tests assert what the user sees, never what an internal handler was called with.

## 2. Coupling to implementation details

```ts
// ❌
await page.locator('div.MuiButton-root.MuiButton-containedPrimary').click();
```

This breaks when MUI publishes a new version, or when the team migrates to Tailwind, or when someone refactors the className. The user doesn't see "MuiButton-root"; they see a "Submit" button.

```ts
// ✅
await page.getByRole('button', { name: 'Submit' }).click();
```

## 3. Arbitrary sleeps

```ts
// ❌
await page.click('button.submit');
await page.waitForTimeout(2000);
expect(await page.textContent('h1')).toBe('Success');
```

Two seconds may be enough today, not enough on the CI runner under load, and pure flake on the engineer's underpowered laptop. Hides real timing bugs by making them probabilistic.

```ts
// ✅
await page.getByRole('button', { name: 'Submit' }).click();
await expect(page.getByRole('heading', { name: 'Success' })).toBeVisible();
```

`expect(...).toBeVisible()` auto-retries until the default timeout.

## 4. Direct database queries in tests

```ts
// ❌
const result = await db.query('SELECT status FROM subscriptions WHERE user_id = ?', [userId]);
expect(result.rows[0].status).toBe('canceled');
```

Couples tests to schema. When the team migrates `subscriptions` to a new table, every test breaks for a reason the spec author never agreed to.

```ts
// ✅
const response = await request.get(`/api/users/${userId}/subscription`);
expect(await response.json()).toMatchObject({ status: 'canceled' });
```

Tests assert against the contract, not the implementation.

## 5. Conditional assertions ("if this then that")

```ts
// ❌
if (await page.getByText('Welcome').isVisible()) {
  await page.getByRole('button', { name: 'Continue' }).click();
}
expect(await page.title()).toBe('Dashboard');
```

The test passes whether the welcome banner appeared or not. It's a test of the test runner, not the application.

```ts
// ✅ — pick one branch and assert it explicitly
await expect(page.getByText('Welcome')).toBeVisible();
await page.getByRole('button', { name: 'Continue' }).click();
await expect(page).toHaveTitle('Dashboard');
```

If both branches need testing, write two `test()` blocks with different `beforeEach` setups.

## 6. Test order dependency

```ts
// ❌
test('first, create the org', async () => { /* creates an org */ });
test('then, invite a member', async () => { /* assumes the org exists */ });
```

Playwright doesn't guarantee test order across files, and `--workers > 1` deliberately runs them in parallel. Order-dependent tests pass on the author's laptop and fail in CI.

```ts
// ✅
test.beforeEach(async ({ request }) => {
  await request.post('/api/test/seed', { data: { org: { name: 'Acme' } } });
});

test('invites a member', async () => { /* ... */ });
```

Each test sets up its own state.

## 7. Asserting on transient toasts without auto-wait

```ts
// ❌
await page.click('button.save');
await page.waitForTimeout(500);
expect(await page.textContent('.toast')).toBe('Saved');
```

Toasts often auto-dismiss after 3 seconds. By the time the assertion runs, the toast might be gone.

```ts
// ✅
await page.getByRole('button', { name: 'Save' }).click();
await expect(page.getByRole('status')).toHaveText('Saved');  // role=status auto-waits and is announced to screen readers
```

## 8. `data-testid` for things that have a stable role

```ts
// ❌
await page.getByTestId('submit-btn').click();  // when there's exactly one Submit button on the page
```

`data-testid` is a fallback. Reach for it only when role-based locators truly can't disambiguate (multiple identical roles, third-party widgets without stable semantics, custom components that the implementer agreed to maintain).

```ts
// ✅
await page.getByRole('button', { name: 'Submit' }).click();
```

If you do need a testid, declare it in `selectors.md` first. The writer refuses to invent testids that aren't declared.

## 9. Snapshot testing the entire DOM

```ts
// ❌
expect(await page.content()).toMatchSnapshot();
```

Any class rename, layout tweak, or framework upgrade breaks the snapshot. Reviewers update the snapshot reflexively. The signal-to-noise ratio collapses.

Use snapshots for narrow, intentional invariants only — and prefer accessibility snapshots (`expect(locator).toMatchAriaSnapshot()`) over DOM snapshots when you do.

## 10. Ignoring console errors

By default, console errors during a test do not fail the test. They should.

```ts
// ✅
test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    throw new Error(`Uncaught: ${err.message}`);
  });
});
```

The fix-loop reads console errors from the trace. Tests that allow uncaught errors to slide produce traces the fix-loop can't act on.

## When the fix-loop sees these patterns

If the fix-loop encounters a test that violates one of these patterns (an arbitrary sleep, a CSS selector, a direct DB query), it treats the test itself as suspect. Per Premise 5, after one fix attempt that doesn't change the failure, the loop flags the test as "may be wrong" and stops. The user clears the flag manually after deciding whether the test or the code is broken.
