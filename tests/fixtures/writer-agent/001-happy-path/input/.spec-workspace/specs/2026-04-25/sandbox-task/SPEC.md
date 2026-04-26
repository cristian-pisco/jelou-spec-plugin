# Cancel pro subscription

A logged-in pro user cancels their subscription and sees a downgrade confirmation banner on the dashboard.

## user-flow.md

### Problem Statement

A pro user cancels their subscription via the settings page. After confirming, the dashboard shows "Your plan was downgraded to Free" and the user's subscription record is in `canceled` state.

### Affected UI Service

- service-frontend

### Routes

| Step | Method | Path | Notes |
|------|--------|------|-------|
| 1 | GET | /login | Auth precondition |
| 2 | GET | /dashboard | Landing |
| 3 | GET | /settings | Subscription panel |
| 4 | POST | /api/subscriptions/cancel | Side-effecting |
| 5 | GET | /dashboard?downgraded=1 | Confirmation |

### Auth Precondition

`logged_in_user`

### Fixtures

- A user `pro@example.test` with an active `pro` subscription, created via `POST /api/test/seed`.

### Steps

1. **Action:** Open `/login`. **Assert:** Page heading reads "Sign in".
2. **Action:** Sign in as `pro@example.test`. **Assert:** URL becomes `/dashboard`.
3. **Action:** Click "Settings" in the nav. **Assert:** Subscription section shows status "Pro".
4. **Action:** Click "Cancel subscription". **Assert:** Confirmation dialog opens with title "Cancel pro plan?".
5. **Action:** Click "Confirm cancel". **Assert:** Dialog closes; banner reads "Your plan was downgraded to Free."

### Assertions Beyond Visible UI

- After step 5, `GET /api/subscriptions/me` returns `{ status: "canceled" }`.

### Service Boot Order

1. service-postgres
2. service-billing
3. service-frontend

### Out of Scope

Email content rendering — covered separately.
