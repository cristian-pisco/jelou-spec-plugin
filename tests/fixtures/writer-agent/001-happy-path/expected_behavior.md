# Fixture 001 — Happy path

## Setup

A SPEC.md with one well-formed `user-flow.md` block. One affected UI service (`service-frontend`). Auth precondition: `logged_in_user`. 5 steps describing a subscription-cancellation flow.

## Expected behavior

The writer agent SHOULD:

1. Emit one `*.spec.ts` file at `services/service-frontend/e2e/cancel-pro-subscription.spec.ts` (slug derived from the flow's Problem Statement).
2. Use role-based locators throughout: `getByRole`, `getByLabel`, `getByText`. No `getByTestId` (no `selectors.md` is present).
3. Use Playwright's auto-retrying `expect(locator).toBeVisible()` patterns; never `waitForTimeout`.
4. Emit a `test.beforeEach` that calls `signInAs(page, request, 'user')` for the auth precondition.
5. Emit one `test()` block per step group. The 5 steps share state (a flowing subscription cancellation), so the writer should emit ONE `test()` with 5 sequential actions+assertions, not 5 separate `test()` blocks.
6. Write an `INDEX.md` next to the spec file listing the test → flow mapping.
7. Verify the file compiles under `tsc --noEmit`.
8. Verify the test FAILS for the right reason (UI doesn't exist yet) by running it once.
9. Report `STATUS: DONE` with file path and test count.

The writer agent SHOULD NOT:

- Invent `data-testid` selectors (no `selectors.md` declared).
- Use CSS selectors or XPath.
- Reach into the database directly for the side-effect assertion (the spec says a row was inserted; assert via the service's `/api/subscriptions/me` instead).
- Use `page.waitForTimeout(...)`.
- Modify any file outside `services/service-frontend/e2e/`.
