# Template: Selectors Companion

> Optional companion to `user-flow.md`. Required only when the spec author wants the writer agent to use specific `data-testid` selectors instead of role-based locators. Per Premise 16 of the design, the writer agent **refuses to invent any `data-testid` not declared here**.

## When to use

You almost never need this file. Modern Playwright best practice is **role-based locators** — `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder`. They derive from the UI's accessibility semantics, which are stable across CSS rewrites and component-library swaps. The writer agent uses these by default.

Use this file only when:

- A component is from a third-party library (a date picker, a rich text editor) that ships unstable role/aria semantics, and pinning to a `data-testid` is the only reliable handle.
- A page has multiple identical role-named elements (three "Submit" buttons on a checkout) and `getByRole('button', { name: /submit/i }).nth(2)` is too fragile.
- The UI deliberately suppresses semantic role for a custom widget and `data-testid` is the only stable handle the implementer agreed to maintain.

If none of these apply, delete this file or leave it empty.

## Format

Each declared `data-testid` is one row. The writer agent emits `page.getByTestId(<id>)` calls for these and only these.

| `data-testid` | Where it lives (page or component) | Why this can't be a role-based locator | Owner (who maintains it) |
|---|---|---|---|
| `subscription-cancel-button` | Settings → Subscription panel | Three "Cancel" buttons on this page (cancel update, cancel subscription, cancel modal). Role-based disambiguation is brittle. | Implementer adds it during GREEN. |
| `downgrade-confirmation-banner` | Dashboard, top of main content | The banner is a `<div>` without a stable role; the implementer keeps the testid for this assertion. | Implementer adds it during GREEN. |

## Contract with the implementer

Every row in this file is a contract:

1. The writer agent emits `page.getByTestId(<id>)` in the test.
2. The implementer must add `data-testid="<id>"` to the corresponding element during the GREEN phase.
3. The fix-loop agent (M3) is allowed to verify the testid is present in the implementer's output; if not, it surfaces the gap as a flagged test (not a code fix), because the spec author chose this selector contract.

If the spec author later wants to drop a testid in favor of a role-based locator, edit this file and the writer regenerates the test on the next RED.

## Naming conventions

- kebab-case
- Scope by feature, not by component file name (`subscription-cancel-button`, not `Settings.tsx-cancel-btn`)
- Avoid generic names (`submit`, `button-1`)
- Singular unless intentionally referring to a list (`product-row` for one row; `product-list` for the container)

## Anti-patterns

- ❌ Listing testids that the writer can derive from role + accessible name (`getByRole('button', { name: 'Cancel' })`). This bloats the contract.
- ❌ Using testids as a workaround for poor accessibility. If the element has no stable role, the better fix is to give it one. Pin a testid only when the role really can't be made stable.
- ❌ Adding testids in code without a corresponding row here. The writer agent won't emit them, so the test won't reference them, so the testid is dead weight in the DOM.
