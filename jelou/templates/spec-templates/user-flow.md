# Template: User Flow (E2E)

> Use this template when a task involves end-to-end user behavior across one or more pages of a UI service. The `jlu-ui-e2e-writer` agent reads this template's filled sections to generate failing Playwright tests during the RED phase.

## When to use

Use this template **in addition to** (not instead of) `ui-component.md` when the task has at least one of:

- A multi-step flow that touches more than one page or route.
- An auth precondition (the user must be signed in to perform the action).
- Test data fixtures (a record must exist before the flow can run).
- An assertion that depends on side effects (a row was inserted, an email was sent, an event was published).

For a single component with no routing or fixture concerns, `ui-component.md` alone is sufficient.

## Pre-filled Sections

### Problem Statement
<!-- FILL: What user task does this flow accomplish? Be concrete: "A logged-in customer cancels their pro subscription and is shown a downgrade confirmation." -->

### Affected UI Service
<!-- FILL: Service id from services.yaml (e.g., service-frontend). If multiple UI services participate (e.g., service-frontend + service-admin), list each on its own line; the writer agent will emit one test file per UI service. -->

- {{ui-service-id}}

### Routes
<!-- FILL: HTTP routes the flow touches, in order. -->

| Step | Method | Path | Notes |
|------|--------|------|-------|
| 1 | GET | /login | Auth precondition |
| 2 | GET | /dashboard | Landing |
| 3 | POST | /api/cancel | Side-effecting |
| 4 | GET | /dashboard?downgraded=1 | Confirmation |

### Auth Precondition
<!-- FILL: One of: none | logged_in_user | logged_in_admin | logged_in_role:<role>. The writer agent picks the matching fixture from auth-fixtures.md. -->

`logged_in_user`

### Fixtures
<!-- FILL: Test data that must exist before the flow runs. State the seed shape; the writer agent will encode it as a Playwright `test.beforeEach` that calls the consumer service's seed API (see references/auth-fixtures.md for the API-driven default). -->

- A user `pro@example.test` with an active `pro` subscription (created via POST /api/test/seed).
- An organization `acme-corp` owned by that user.

### Steps
<!-- FILL: Each step is one user-visible action and one assertion. The writer agent emits one `test()` block per step UNLESS the steps share state (in which case it emits one `test()` with multiple `await` calls). Action verbs only ("Click", "Type", "Wait for"); no implementation details ("setState", "useEffect"). -->

1. **Action:** Open `/login`. **Assert:** Page heading reads "Sign in".
2. **Action:** Type `pro@example.test` into the email field, type the test password into the password field, click "Sign in". **Assert:** URL becomes `/dashboard`.
3. **Action:** Click the "Settings" link in the nav. **Assert:** A "Subscription" section is visible with status "Pro".
4. **Action:** Click "Cancel subscription". **Assert:** A confirmation dialog opens with the title "Cancel pro plan?".
5. **Action:** Click "Confirm cancel" in the dialog. **Assert:** The dialog closes; the dashboard banner reads "Your plan was downgraded to Free."

### Assertions Beyond Visible UI
<!-- FILL: Any assertions that go beyond DOM (e.g., "An email was sent", "A row was inserted", "An event was published"). The writer agent picks the appropriate Playwright pattern (network interception, API poll, fixture inspection). Skip if none. -->

- After step 5, the `subscriptions` row for `pro@example.test` has `status='canceled'` (assert via the consumer service's read API, not direct DB).

### Service Boot Order
<!-- FILL: Ordered list of services that must be running for this flow to work end-to-end. The first entry boots first; subsequent entries boot only after the prior service's readiness signal fires. The set must be a subset of TASKS.md `affected_services`. -->

1. service-postgres
2. service-auth
3. service-billing
4. service-frontend

### Out of Scope
<!-- FILL: What this flow intentionally does NOT cover. Helpful for the test reviewer. Example: "Email content rendering — covered in a separate flow." -->

## Interview Hints

- Is this flow gated on a specific user role? If yes, name the role and list it under Auth Precondition.
- Are there error paths (network failure, validation rejection)? Each error path is its own user flow file or its own step group.
- Does the flow have a "happy path + edge case" structure? Prefer one user-flow.md per case; the writer agent will combine them in one Playwright spec file when the affected UI service is the same.
- If a step depends on a previous step's state (e.g., a token in localStorage), say so explicitly. The writer agent will emit the steps inside one `test()` block instead of separate ones.
- For any `data-testid` you reference, list it in the sibling `selectors.md` companion (per Premise 16 of the design — the writer agent refuses to invent test ids).

## Acceptance Criteria

- A filled `user-flow.md` produces one or more Playwright test files when fed to `jlu-ui-e2e-writer`.
- Each test file imports `@playwright/test` and runs (will fail RED) under `npx playwright test`.
- Tests use role-based locators (`getByRole`, `getByLabel`, `getByText`) by default; `data-testid` only when declared in `selectors.md`.
- Tests do not reach into the database directly; side-effect assertions go through the service's read API.
