# Backend E2E Authoring — the assertion doctrine

> What a backend E2E suite must **assert**. The companion to `jlu-backend-e2e-runner.md`
> (which says *how* to run one) and to the case-matrix in `jlu-test-writer.md` (which
> says *what inputs* to send). Read this whenever you author a suite under the E2E path
> (`test/e2e/**` / `*.e2e-spec.ts`).

## Premise

A backend E2E exercises the **real controller over real HTTP** against **real
dependencies** (the database, the cache, the queue — brought up dependencies-only via
Testcontainers; the service under test runs on the host). Its whole reason to exist is
to assert the **observable side effects of a write**, not the request validation a
mocked Tier-1 test already covers.

A suite that sends a `POST` and only asserts `expect(res.status).toBe(201)` is **not a
backend E2E** — it is a slow unit test. The 2xx tells you the handler did not throw; it
does not tell you the record was persisted, the cache was populated, or the event was
emitted. The doctrine below exists because a green status code is the single most
common false-positive in a backend suite.

## The inputs/side-effects split

- **Inputs** — covered by the case-matrix (`jlu-test-writer.md`): one happy path, one
  rejecting payload per validation decorator, one realistic cross-reference payload.
  That doctrine still applies; do not duplicate it here.
- **Side effects** — covered by THIS document: after the request returns, assert what
  the write actually did to the system of record.

## Rule 1 — Assert DB persistence, beyond the 2xx

For every mutating endpoint (`POST` / `PUT` / `PATCH` / `DELETE`), assert the
datastore reflects the change after the call — never trust the status code alone:

- **Create** → read the entity back and assert its fields. Prefer the service's own
  read endpoint (`GET /resource/:id`) so the assertion goes through the same
  serialization a client sees. Querying the real DB the test booted is acceptable when
  no read endpoint exposes the written field.
- **Update** → assert the changed fields changed AND the untouched fields did not.
- **Delete** → assert a subsequent read returns 404 / the row is gone.
- **Failure path** → when the handler is supposed to reject (validation, conflict,
  auth), assert **nothing was persisted** — a partial write on a 4xx is a real bug an
  E2E is uniquely positioned to catch.

Read the entity back through a **fresh request** (new HTTP call / new DB read), not from
the response body of the write — echoing the request back proves nothing about storage.

**Read endpoints (`GET`).** A read is not exempt — it just asserts the *other* direction
of the datastore relationship: that the response is **sourced from the real datastore**,
not from a mocked repository.

- **Single resource** → seed a row through a real write (or fixture), `GET` it, and
  assert the returned payload reflects the seeded fields field-for-field. Assert `404`
  (or empty) for an id that does not exist.
- **Collections** → exercise the real query surface: filter, pagination, and sort
  against seeded rows (the case-matrix's realistic payloads), and assert the **result
  set is correct** — the right rows, in the right order, with the right page window — not
  merely a `200` with some array. A filter that names a real column must return only
  matching rows; an out-of-range page must return empty, not the first page.
- **Authorization scoping** → assert the caller sees **only the rows it is entitled to**
  (tenant/owner scoping); a second identity must not read the first's rows.
- **Read-through cache** → its populate/hit/invalidate behavior follows Rule 2.

## Rule 2 — Assert cache side effects (populate + invalidate)

When the endpoint reads or writes a cache (Redis or equivalent), the cache is a system
of record and gets its own assertions:

- **Write-through / write-behind** → after a write, assert the cache key holds the new
  value (and the expected TTL, when the contract specifies one).
- **Read-through** → assert a cold request populates the cache (miss → fill) and a warm
  request is served from it (hit), e.g. by asserting the second call does not re-touch
  the origin, or by reading the key directly.
- **Invalidation / eviction** → after an update or delete, assert the stale key is gone
  (or refreshed). A cache that serves stale data after a write is the classic bug this
  rule targets; a suite that never asserts invalidation cannot catch it.

If the service has no cache on the exercised path, say so once in the suite and skip
this rule — do not fabricate a cache assertion.

## Rule 3 — Other durable side effects

When the flow emits them, assert them through a real boundary, never a spy on an
internal collaborator:

- **Events / messages** → assert via the consumer's read API or a real subscriber the
  test attaches; never assert on a mocked producer.
- **Idempotency** → when the contract promises it, replay the request and assert the
  side effect happened exactly once.
- **Transactional integrity** → when a multi-step write must be atomic, force a failure
  mid-flow and assert the whole transaction rolled back (no orphan rows).

## Anti-patterns (each defeats the suite's purpose)

- Asserting only the HTTP status / response shape of a mutating call.
- **Mocking the repository, the cache, or the DB inside an E2E.** That turns the E2E
  back into a Tier-1 test and asserts the test's own fake — it never exercises the real
  datastore. Backend E2E mocks NOTHING below the controller; it uses the **real
  dependencies** the runner booted.
- Reading the written entity back from the write's own response body instead of a fresh
  request.
- Asserting cache behavior against an in-memory stub instead of the real cache the
  runner brought up.

## Per-suite checklist (before reporting DONE)

- [ ] Every mutating endpoint reads its entity back through a fresh request and asserts
      the persisted fields — not just the 2xx.
- [ ] Every read (`GET`) endpoint asserts the response is sourced from the real
      datastore (seeded rows reflected; filter/pagination/sort and authz scoping
      exercised), not merely a `200`.
- [ ] Every failure path asserts **nothing** was persisted.
- [ ] Every cached path asserts populate AND invalidation against the real cache.
- [ ] No repository / cache / DB is mocked anywhere in the suite.
- [ ] Inputs follow the case-matrix; side effects follow Rules 1–3 above.
