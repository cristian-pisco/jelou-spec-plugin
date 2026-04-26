# Systematic Debugging

> Reference for jelou subagents (`jlu-implementer`, `jlu-build-validator`, and `jlu-test-writer` on re-invocation) when tests refuse to go green, builds fail repeatedly, or behavior is unexpected. Adapted from `superpowers:systematic-debugging` for the orchestrator/subagent execution model.

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you have not completed Phase 1, you cannot propose a fix. Symptom fixes are failure — they create new bugs and waste retries.

## When to Apply

- Implementer's tests do not go green after **2 fix attempts**
- Build-validator's compile fails after **round 2**
- Test-writer is re-invoked with an implementer objection (Decision #5) and the test does not obviously violate the spec
- Cross-service contract failure where it is unclear which side is wrong
- Same fix is being attempted with minor variations
- Each fix surfaces a new symptom in a different file or service

**Do not skip when:**
- The bug "looks simple" — simple bugs have root causes too
- You are under time pressure — systematic is faster than thrashing
- You have already tried 2 fixes and the third feels obvious

## The Four Phases

You MUST complete each phase before proceeding to the next.

### Phase 1 — Root Cause Investigation

Before attempting any fix:

1. **Read the error completely.** Stack traces, exit codes, file paths, line numbers. The fix is often in the message itself.
2. **Reproduce consistently.** Run the failing test or build in isolation. Confirm the failure is deterministic. If it is not, gather more data — do not guess.
3. **Check recent changes.** `git diff`, recent commits on this branch, new dependencies. What changed that could cause this?
4. **For multi-component failures, instrument the boundaries.** See [Multi-Service Boundary Instrumentation](#multi-service-boundary-instrumentation) below — this is the highest-value Phase 1 technique for jelou tasks.
5. **Trace the bad value backward.** When the error fires deep in a call chain, walk back frame by frame. Where did the bad value originate? What called this with that value? Continue until you reach the source. Fix at the source, not at the symptom.

**Phase 1 is complete when** you can state in one sentence: *the failure is caused by X originating in Y because of Z.*

### Phase 2 — Pattern Analysis

1. **Find a working example.** Locate similar code in the same service that works. Read it line by line — do not skim.
2. **List every difference** between the working code and the broken code. Do not assume "that cannot matter."
3. **Map dependencies.** What config, environment variables, fixture state, or external services does the broken code rely on? Which of those differ from the working example?

### Phase 3 — Hypothesis and Testing

1. **State a single hypothesis** in writing: *"I think X is the root cause because Y."* Specific, not vague.
2. **Test minimally.** Make the smallest possible change that would prove or disprove the hypothesis. One variable at a time. Do not bundle changes.
3. **Verify before continuing.** Did it work? Yes → Phase 4. No → form a new hypothesis. Do not pile fixes on top.
4. **When you do not know, say so.** Report `status: blocked` with `outcome` describing what was investigated and what remains unclear. Do not pretend to understand.

### Phase 4 — Implementation

1. **Create a failing test that captures the bug** (if one does not already exist). The minimum reproduction. This is your regression guarantee.
2. **Implement a single fix** that addresses the root cause identified in Phase 1. One change. No "while I am here" improvements. No bundled refactoring.
3. **Verify the fix.** Original failure resolved? No other tests broken? If both yes → done.
4. **If the fix does not work, STOP.** Count attempts. Return to Phase 1 with the new evidence — do not attempt another fix.

### Phase 4.5 — Three-Strike Rule

**After 3 failed fix attempts, STOP and question the architecture.**

Patterns that indicate an architectural problem rather than a hypothesis-level error:

- Each fix exposes a new shared-state, coupling, or contract problem in a different place
- Fixes require "massive refactoring" of code outside the phase scope
- Each fix creates a new symptom elsewhere (whack-a-mole)

**At this point:**

1. Do not attempt fix #4 without explicit orchestrator approval.
2. Report `status: blocked` with a `risks` entry of severity `high` describing the suspected architectural issue.
3. Include in `outcome`: the three hypotheses tried, why each failed, and what you now believe is wrong at the architecture level.
4. Let the orchestrator escalate to the user.

## Multi-Service Boundary Instrumentation

The single most valuable Phase 1 technique for jelou tasks. When a failure spans services (gateway → service-A → service-B → database) or layers (CI → build → test → deploy), the symptom usually appears far from the cause.

**Recipe:**

1. Identify every component boundary the request or data crosses.
2. At each boundary, log: what entered, what exited, the relevant config/env, the timestamp.
3. Run the failing scenario once. Read the logs end to end.
4. The boundary where "expected entered, unexpected exited" is your suspect.
5. Investigate inside that one component — not the whole system.

**Example (cross-service auth failure):**

```
Boundary 1: gateway → service-auth
  Log: incoming Authorization header, outgoing JWT claim set
Boundary 2: service-auth → service-orders
  Log: forwarded user ID, scope claims
Boundary 3: service-orders → database
  Log: query, parameter values
```

If gateway → service-auth shows valid JWT but service-auth → service-orders shows empty user ID, the bug lives in service-auth's claim extraction. You investigate one service, not three.

**For test failures:** the same pattern applies inside a single service across modules. Log at module boundaries (controller → service → repository → database) and find the layer where data goes bad.

## How This Maps to Existing jelou Loops

| Loop | Direct fix rounds | Phase 1 instrumentation | Phase 2–3 hypothesis | Phase 4.5 escalation |
|------|-------------------|-------------------------|---------------------|----------------------|
| `jlu-implementer` (test green attempts) | 1–2 | attempt 3 | attempt 4 | attempt 5 → `status: blocked` |
| `jlu-build-validator` (5-round fix loop) | rounds 1–2 | round 3 | round 4 | round 5 → `FAIL` per existing limit |

In both cases, the structured `blocked`/`FAIL` report MUST include the three hypotheses tried, the evidence that disproved them, and the suspected architectural issue.

## Reporting Status During Investigation

While Phase 1 is incomplete:
```
status: in_progress
outcome: "Investigating root cause. Boundary instrumentation added at <points>. Evidence collected: <summary>. Next step: <hypothesis to test>."
```

When 3+ attempts have failed:
```
status: blocked
outcome: "Three fixes attempted (see risks). Each surfaced a new symptom in a different layer. Suspect architectural issue: <description>."
risks:
  - description: "<hypothesis 1, why it failed>"
    severity: medium
  - description: "<hypothesis 2, why it failed>"
    severity: medium
  - description: "<suspected architecture issue>"
    severity: high
    mitigation: "<what should be discussed before fix #4>"
```

Never report `status: success` without a verification command that exited cleanly. Self-attestation is not evidence.

## Red Flags — STOP and Restart from Phase 1

If you catch yourself thinking:

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It is probably X, let me fix that"
- "I do not fully understand but this might work"
- "Pattern says X but I will adapt it differently"
- "One more fix attempt" (when 2+ have already failed)
- Each fix reveals a new problem in a different place

**All of these mean: STOP. Return to Phase 1.**

## Rationalizations and Reality

| Excuse | Reality |
|--------|---------|
| "Issue is simple, no need for process" | Simple bugs have root causes too. The process is fast for simple bugs. |
| "Emergency, no time for systematic" | Systematic debugging is faster than guess-and-check thrashing. |
| "Just try this first, then investigate" | The first fix sets the pattern. Do it right from the start. |
| "I will write the test after the fix works" | Untested fixes do not stick. The test proves the fix, not the other way around. |
| "Multiple fixes at once saves time" | You cannot isolate which fix worked. You introduce new bugs. |
| "I see the problem, let me fix it" | Seeing a symptom is not the same as understanding the cause. |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question the pattern, do not fix again. |
| "Reference is too long, I will adapt the pattern" | Partial understanding guarantees bugs. Read it completely. |

## Companion Techniques

### Backward Call-Stack Tracing

When the error fires deep in a call chain, do not fix where it appears. Walk the chain backward:

1. What code directly produces the error?
2. What called that with the bad value?
3. What called *that* with the bad value?
4. Continue until you reach the original trigger.
5. Fix at the trigger, not at the symptom.

Add stack traces or boundary logs at each frame if manual reading is not enough. The trigger is often several frames above where the error fires.

### Defense in Depth

After identifying and fixing the root cause, add validation at multiple layers so the bug becomes structurally impossible to reintroduce:

- Layer 1: validate at the entry point (input boundary)
- Layer 2: validate at business-logic boundaries
- Layer 3: environment-specific guards (e.g., refuse destructive operations outside test directories during tests)
- Layer 4: debug instrumentation that captures context if any future failure occurs

Different layers catch different reintroduction paths (refactoring, mocks, new callers). One validation point is "we fixed the bug." Multiple layers is "the bug is impossible."

## When Investigation Reveals No Root Cause

If systematic investigation reveals the issue is genuinely environmental, timing-dependent, or caused by an external system:

1. Document what was investigated in the phase file's Execution section.
2. Implement appropriate defensive handling (retry with backoff, explicit timeout with comment justifying the duration, structured error message).
3. Add monitoring or logging so a future failure has more evidence.
4. Note the residual risk in the subagent report's `risks` array.

**But:** 95% of "no root cause" conclusions are incomplete investigation. Default to assuming the cause is findable.

## Quick Reference

| Phase | Activities | Done when |
|-------|------------|-----------|
| 1. Root Cause | Read error, reproduce, check changes, instrument boundaries, trace backward | You can state cause in one sentence |
| 2. Pattern | Find working example, list differences, map dependencies | You know what is structurally different |
| 3. Hypothesis | State theory in writing, test minimally, verify | Theory confirmed or replaced |
| 4. Implementation | Failing test, single fix, verify | Original failure resolved, no regressions |
| 4.5. Three Strikes | After 3 failed fixes, question architecture, escalate | `status: blocked` with architectural hypothesis |

## Why This Matters

Empirically (from the source skill's data and parallel jelou experience):

- Systematic approach: 15–30 minutes to fix.
- Random fixes approach: 2–3 hours of thrashing.
- First-time fix rate: 95% systematic vs. 40% random.
- New bugs introduced: near zero systematic vs. common with random fixes.
