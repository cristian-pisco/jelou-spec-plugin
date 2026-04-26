# Fixture 002 — Undeclared `data-testid`

## Setup

A SPEC.md whose `user-flow.md` block references a step "Click the `subscription-cancel-button`" which the spec author wrote assuming a `data-testid`. NO `selectors.md` companion is present.

## Expected behavior

The writer agent SHOULD:

- Detect the implicit testid reference.
- Refuse to invent the testid (per Premise 16).
- Report `STATUS: NEEDS_CONTEXT` with a message explicitly naming the missing `selectors.md` declaration:
  - `STATUS: NEEDS_CONTEXT — missing: data-testid declaration in selectors.md for "subscription-cancel-button"`
- Not write any `*.spec.ts` file (because the spec is incomplete).
- Not write a partial INDEX.md.

The writer agent SHOULD NOT:

- Emit `getByTestId('subscription-cancel-button')` and hope the implementer adds it.
- Substitute a guessed role-based locator.
- Write a stub test file with a TODO comment.
