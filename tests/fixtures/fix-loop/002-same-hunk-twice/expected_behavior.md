# Fixture 002 — Same `file:hunk` edited twice → flag the test

## Setup

A failing test on attempt #3 (the orchestrator dispatched after two prior attempts). The dispatch payload includes `PRIOR_EDITS`:

```
[
  { "file": "src/components/Settings.tsx", "hunk_hash": "a1b2c3d4e5f6" },
  { "file": "src/components/Settings.tsx", "hunk_hash": "a1b2c3d4e5f6" }
]
```

Both prior edits hit the SAME hunk. The agent's planned third edit, when hashed, produces the same `a1b2c3d4e5f6`.

## Expected behavior

The fix-loop agent SHOULD:

- Compute its planned hunk_hash before writing.
- Recognize that the planned hash matches a prior attempt on the same `FAILING_TEST_NAME`.
- Refuse to write.
- Report `STATUS: flagged reason=same_hunk_twice` with details naming the file:line and the hunk hash.

The fix-loop agent SHOULD NOT:

- Apply any further edit on this assertion.
- Fall back to editing a different file as a "creative workaround".
- Retry with a slightly different hunk to dodge the hash check.
