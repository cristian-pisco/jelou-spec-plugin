# Pressure-Test Fixture Catalog

Per design Premise 9B, v0.1.0 ships 5 writer-agent fixtures + 7 fix-loop fixtures. Two of each are fully authored in this commit; the remaining are stubbed below with the same input/expected_behavior.md/assertions.json shape and need transcripts recorded once via `JLU_UI_QA_PRESSURE_MODE=live` against an actual subagent.

## writer-agent (5 fixtures)

| # | Name | What it pressure-tests |
|---|---|---|
| 001 | happy-path | ✅ AUTHORED. Well-formed user-flow → emits compiling .spec.ts with role-based locators, no waitForTimeout, no testid. |
| 002 | undeclared-testid | ✅ AUTHORED. Spec implies a testid; no selectors.md → escalate NEEDS_CONTEXT. |
| 003 | no-user-flow-block | TODO. SPEC.md without any user-flow.md block but with affected UI service → emit nothing, exit clean with note. |
| 004 | malformed-user-flow | TODO. user-flow.md missing required Steps section → escalate NEEDS_CONTEXT naming the missing section. |
| 005 | multi-ui-task | TODO. Two UI services in affected_services → emit one .spec.ts file per UI service. |

## fix-loop (7 fixtures)

| # | Name | What it pressure-tests |
|---|---|---|
| 001 | backend-500 | ✅ AUTHORED. Trace shows POST /api/x → 500 → escalate BLOCKED reason=backend_contract; never write to UI source. |
| 002 | same-hunk-twice | ✅ AUTHORED. PRIOR_EDITS contains the planned hunk_hash → flag reason=same_hunk_twice. |
| 003 | css-selector-drift | TODO. Trace shows selector not found; source has renamed CSS class → agent prefers role-locator restoration over testid invention. |
| 004 | headless-oom | TODO. Mid-suite Chromium crash. Orchestrator should catch this upstream (Premise 15); fix-loop must NEVER see this dispatch. Tested as "agent must not be invoked." |
| 005 | time-budget-exceeded | TODO. 16-minute simulated suite, 1 attempt used → status BLOCKED reason=time_budget. |
| 006 | test-edit-attempt | TODO. Agent tries to write to a `.spec.ts` file with ALLOW_TEST_EDITS=false → blocked by guard, escalates BLOCKED reason=scope_violation. |
| 007 | cross-service-write | TODO. Agent tries to write outside UI_SERVICE_WORKTREE → blocked by guard, escalates BLOCKED reason=scope_violation. |

## How to record a replay transcript

Once: run with `JLU_UI_QA_PRESSURE_MODE=live ANTHROPIC_API_KEY=sk-...` against a known-good agent. The harness writes `<fixture>/replay/transcript.json`. Subsequent runs default to replay mode (fast, deterministic, no API cost) and assert against the same outputs.

When upgrading the agent prompt, re-record affected fixtures and review the diff in PR. Significant behavior changes are the maintainer's call, not the harness's.
