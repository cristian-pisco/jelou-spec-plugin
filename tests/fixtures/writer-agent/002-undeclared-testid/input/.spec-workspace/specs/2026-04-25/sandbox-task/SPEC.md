# Cancel pro subscription (testid path)

A logged-in pro user clicks the cancel button on the dashboard and sees a confirmation dialog.

## user-flow.md

### Problem Statement

A pro user clicks the cancel-subscription button on the dashboard and confirms cancellation in a modal.

### Affected UI Service

- service-frontend

### Routes

| Step | Method | Path | Notes |
|------|--------|------|-------|
| 1 | GET | /dashboard | Landing |
| 2 | POST | /api/subscriptions/cancel | Side-effecting |

### Auth Precondition

`logged_in_user`

### Fixtures

- A user `pro@example.test` with an active `pro` subscription, created via `POST /api/test/seed`.

### Steps

1. **Action:** Open `/dashboard`. **Assert:** The `subscription-cancel-button` is visible.
2. **Action:** Click the `subscription-cancel-button`. **Assert:** Confirmation dialog with title "Cancel pro plan?" appears.

### Out of Scope

Email content rendering — covered separately.
