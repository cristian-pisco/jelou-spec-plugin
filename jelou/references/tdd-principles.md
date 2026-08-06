# TDD Principles

> Canonical philosophical reference for `jlu-test-writer`, `jlu-implementer`, `jlu-tdd-cycle`, `jlu-refactor-agent`, and `jlu-qa-agent`. The *operational* protocol (which agent runs when, tier system) lives in `tdd-cycle.md`. This doc is the shared *philosophical* source — every agent in the TDD pipeline must apply these principles regardless of which step it owns.

## 1. The Cycle

```
RED → GREEN → (repeat)
```

- **RED**: write one failing test that describes one observable behavior.
- **GREEN**: write the *minimum* production code that makes it pass.

**Refactoring is not part of the loop.** It runs once per service at the end of the
task (execute-task Step 8a.3, `jlu-refactor-agent`), guided by §7. During the loop,
authoring agents only *report* refactor candidates — they never apply them.

**Never refactor while RED.** Get to GREEN first.

## 2. Test Behavior, Not Implementation

Test names and assertions describe what the system **does** for a caller, not how it does it internally.

**Bad — tests how (implementation detail):**

```typescript
it("should call userRepository.findById with the correct ID", async () => {
  await service.getUser("user-123");
  expect(userRepository.findById).toHaveBeenCalledWith("user-123");
});
```

**Good — tests what (observable behavior):**

```typescript
it("should return the user when a valid ID is provided", async () => {
  const user = await service.getUser("user-123");
  expect(user).toEqual({ id: "user-123", name: "Alice" });
});
```

**Self-test:** *Would this test still make sense if the implementation were completely rewritten?* If not, rewrite it.

Red flags:
- Mocking your own classes/modules (see §6).
- Asserting on call counts/order.
- Testing private methods directly.
- Verifying through external means (querying the DB instead of using the interface).
- Test breaks when refactoring without behavior change.

## 3. Vertical Slicing Within a Phase

Even within a single phase, prefer vertical slices to horizontal slices.

```
WRONG (horizontal):
  RED:   test1, test2, test3
  GREEN: impl1, impl2, impl3

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
```

Why: tests written in bulk test *imagined* behavior, not *actual* behavior. They become insensitive to real changes — passing when behavior breaks, failing when behavior is fine. Vertical slicing lets each test respond to what the previous cycle revealed.

How this plugin applies it:

- `jlu-tdd-cycle` runs vertical slicing literally (one agent, FR-by-FR loop) for every
  phase. Keep phases small (the proposal agent splits large phases) so a single session
  stays within its context budget.

One deliberate exception: rejection cases for the same DTO/validation surface —
together with that surface's boundary cases — are batched into a single RED→GREEN cycle
(see `tdd-cycle.md` "Case-Matrix Derivation Procedure"). The coverage floor is
untouched — batching changes how many test runs the loop pays, not how many cases
exist.

## 4. Deep Modules

A **deep module** has a small interface and a deep implementation. Complexity is hidden inside, not exposed.

```
[ small interface ]  ← few methods, simple params
[ deep impl       ]  ← complex logic, hidden
```

A **shallow module** is the opposite: large interface, thin implementation. It exposes complexity to every caller.

Ask before exposing a new method or parameter:
- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity inside?

This is about the *interface offered to callers*, not internal structure. Inside the module, many small focused functions is fine.

## 5. Interface Design for Testability

If a piece of code is hard to test, the test is telling you the *interface* needs work — not that the test needs more elaborate mocking.

1. **Accept dependencies, don't create them.**

   **Testable — dependency is injected:**
   ```typescript
   function processOrder(order, paymentGateway) {}
   ```
   **Hard to test — dependency is constructed internally:**
   ```typescript
   function processOrder(order) {
     const gateway = new StripeGateway();
   }
   ```

2. **Return results, don't produce side effects (when possible).**

   **Testable — returns a result:**
   ```typescript
   function calculateDiscount(cart): Discount {}
   ```
   **Hard to test — mutates its input:**
   ```typescript
   function applyDiscount(cart): void { cart.total -= discount; }
   ```

3. **Small surface area.** Fewer methods → fewer tests needed. Fewer params → simpler test setup.

## 6. Mock at Boundaries Only

Mock only at *system boundaries*:
- External APIs (payment, email, third-party SDKs).
- Time / randomness.
- Sometimes databases and file systems (prefer a test DB / temp dir when feasible).

**Do not mock:**
- Your own classes/modules.
- Internal collaborators.
- Anything you control.

If your code is hard to mock at the boundary, that's an interface-design problem (§5). Prefer SDK-style interfaces (one specific function per external operation) over generic fetchers (one method with a switch on endpoint):

**Good — each function is independently mockable:**

```typescript
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
};
```

**Bad — mocking requires conditional logic inside the mock:**

```typescript
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

## 7. Refactor Candidates

After GREEN, look for:
- **Duplication** → extract function/class.
- **Long methods** (> ~50 lines) → break into private helpers, keep tests on public interface.
- **Shallow modules** → combine or deepen (§4).
- **Feature envy** (method uses another class's data more than its own) → move it where the data lives.
- **Primitive obsession** (passing strings/ints that really represent domain concepts) → introduce a value object.
- **What the new code revealed** about pre-existing code (often the best refactor candidates).

Refactor steps:
1. Identify one candidate.
2. Apply the smallest surgical change.
3. Re-run tests — must still be green.
4. Repeat or stop.

Stop conditions:
- The remaining candidates are speculative or aesthetic ("this could be cleaner someday").
- The next candidate would change behavior — that needs a new RED → GREEN cycle, not a refactor.
- The diff is starting to balloon — refactor scope should stay near the new code's blast radius.

## 8. Anti-Patterns

Check every slice against these three before moving on. Each one names a failure
mode, its tell, and the fix:

- **Implementation-coupled** — the test mocks internal collaborators, asserts call
  counts/order, tests private methods, or verifies through a side channel (querying
  the DB instead of using the interface). The tell: the test breaks when you
  refactor but behavior hasn't changed. Fix per §2 and §6.
- **Tautological** — the assertion recomputes the expected value the way the code
  does (`expect(add(a, b)).toBe(a + b)`), so it passes by construction and can never
  disagree with the code. Expected values must come from an independent source of
  truth — a known-good literal, a worked example, the spec.
- **Horizontal slicing** — tests written in bulk ahead of implementation verify
  *imagined* behavior. One slice at a time, per §3 (rejection batches for one
  surface are the only multi-test slice).

Minimality still holds: production code is minimal for the current tests, no
speculative features, no new shallow modules (§4).

## 9. When You're Stuck

If you can't make a test pass after 2 fix attempts:
- Stop trying direct fixes. Switch to root-cause investigation per `systematic-debugging.md`.
- If still stuck after attempt 3, that's the three-strike rule: report `status: blocked` with the architectural hypothesis. Do not pile fix #4 on top.

If a test feels impossible to write cleanly:
- Look at the interface, not the test. §5 is usually the answer.

If a test is wrong:
- Never modify it silently to make it pass. If you are the phase's authoring agent (`jlu-tdd-cycle`), follow the Self-Correction Rule in `jlu-tdd-cycle.md` (document the issue, rewrite the test, quote the spec justification). Otherwise, flag it in your report instead of editing it.
