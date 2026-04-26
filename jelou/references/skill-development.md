# Skill Development (TDD for Agent Prompts and Skills)

> Methodology for authoring or editing jelou skills (in `skills/`) and agent prompts (in `agents/` + `.opencode/agents/`). Adapted from `superpowers:writing-skills`. Pairs with the existing pressure-test harness at `tests/pressure/runner.mjs`.

## Core Premise

If you did not watch an agent fail without your skill or prompt, you do not know whether the skill teaches the right thing.

```
NO SKILL OR AGENT PROMPT EDIT WITHOUT A FAILING FIXTURE FIRST
```

This applies to **new** skills/agents AND **edits** to existing ones. The same Iron Law as TDD-for-code, applied to documentation.

## Two Modes for the Pressure Harness

The harness at `tests/pressure/runner.mjs` runs in two modes:

### Regression mode (current default)

Existing agents (`writer-agent`, `fix-loop`) have fixtures under `tests/fixtures/<agent>/`. Every PR runs the full fixture set. Catches prompt regressions when the agent prompt is edited.

### TDD mode (new use case)

When adding a new agent or significantly editing an existing one:

1. **RED**: Author a fixture and run it. The agent's current behavior should fail the assertion.
2. **GREEN**: Edit the agent prompt minimally to address the specific failure. Re-run; the assertion should pass.
3. **REFACTOR**: Identify new rationalizations the agent finds. Add explicit counters. Re-run until bulletproof.

The harness currently supports two agent types (`writer-agent`, `fix-loop`). Extending it to additional agents is a precondition for adopting TDD mode for those agents — see [Extending the Harness](#extending-the-harness) below.

## TDD-for-Skills Mapping

| TDD concept | Skill / agent authoring |
|-------------|-------------------------|
| Test case | Pressure fixture (`input/`, `expected_behavior.md`, `assertions.json`) |
| Production code | Skill body or agent prompt |
| RED (test fails) | Agent violates the rule without the prompt edit |
| GREEN (test passes) | Agent complies with the prompt edit in place |
| Refactor | Close loopholes, add explicit counter-rationalizations |
| Write test first | Author fixture before any prompt edit |
| Watch it fail | Document baseline rationalizations verbatim |
| Minimal code | Write only the prompt content that addresses observed failures |
| Refactor cycle | Find new rationalizations → plug → re-verify |

## Skill Types

### Discipline (rule-enforcing)

Examples in jelou: `tdd-cycle.md`, `systematic-debugging.md`, `subagent-contract.md`.

Tested with: pressure scenarios (time pressure, sunk cost, exhaustion). Success criterion: agent follows the rule under maximum pressure.

### Technique (how-to)

Examples in jelou: `e2e-anti-patterns.md`, `playwright-conventions.md`, `dev-server-readiness.md`, `worktree-resolution.md`.

Tested with: application scenarios. Success criterion: agent applies the technique correctly to a novel scenario.

### Reference (lookup material)

Examples in jelou: `model-tiers.md`, `claude-code-runtime.md`, `git-conventions.md`, `docker-conventions.md`, `dev-block-schema.md`.

Tested with: retrieval scenarios. Success criterion: agent finds and correctly applies the right entry.

## CSO — Description Discipline (Critical)

Every jelou skill in `skills/` has a `description:` field used by Claude Code and OpenCode to decide which skill to load for a given task.

### The Rule

```
description = TRIGGER conditions only. NEVER summarize the workflow.
```

### Why

When a description summarizes the workflow, the host treats it as a shortcut and follows the description instead of reading the full skill content. The skill body becomes documentation the host skips.

Empirical evidence (from the source skill): a description saying "code review between tasks" caused Claude to do ONE review even though the skill flowchart specified TWO reviews. Changing the description to triggers-only ("Use when executing implementation plans with independent tasks") restored two-review compliance.

### Audit of Existing jelou Skill Descriptions

Existing descriptions that violate the rule (the post-em-dash clause is a workflow summary):

```yaml
# ❌ skills/close-task
description: "Use after a PR is merged — updates ClickUp, cleans up artifacts, and marks the task as closed."

# ❌ skills/execute-task
description: "Use when a spec is approved and ready to implement — runs the full TDD pipeline with proposal generation, phase execution, and QA."

# ❌ skills/new-task
description: "Use when starting new work — creates a task, interviews you about the spec, and sets up worktrees."
```

The trigger phrases (the `Triggers: ...` clauses already present) are fine; the post-em-dash workflow summary is the trap.

### Compliant Format

```yaml
# ✅ Triggers only, no workflow summary
description: "Use after a PR is merged. Triggers: 'close task', 'PR was merged', 'task is done', 'wrap up'."

# ✅ Triggers + symptoms, no workflow
description: "Use when a spec is approved and ready to implement. Triggers: 'execute task', 'start implementation', 'build it', 'run the task'."
```

A separate cleanup pass to align all 15 jelou skill descriptions with this rule should run as a follow-up to adopting this reference.

## Token Targets

| Document type | Target |
|---------------|--------|
| Frequently-loaded discipline references (e.g., `tdd-cycle.md`, `systematic-debugging.md`) | < 500 lines |
| Infrequently-loaded technique/reference docs | < 500 lines |
| Agent prompts (`agents/*.md`) | < 300 lines |
| Workflow files (`jelou/workflows/*.md`) | size scales with workflow complexity; split into phases with explicit boundaries |

When the target is exceeded, ask: can content split into a separately referenced doc that loads only when needed?

## Anti-Patterns

### Narrative example

> "In session 2026-04-01 we found that the implementer..."

Too specific, not reusable, dates rot.

### Multi-language dilution

`example-ts.ts`, `example-py.py`, `example-go.go` inside the same skill.

Maintenance burden and mediocre quality across all of them. One excellent example in the most relevant language beats many.

### Code in flowcharts

Flowchart nodes containing actual code instead of decision labels.

Cannot copy-paste, hard to read, and obscures the decision structure.

### Generic labels

Steps named `step1`, `step2`, `helper3` instead of semantic names.

Adds no information; reader has to read the body anyway.

### Workflow summary in description

Already covered in CSO. Worth repeating: the description must NOT summarize the workflow.

## Closing Loopholes (Bulletproofing)

Discipline skills (TDD, systematic-debugging, subagent-contract) need to resist rationalization. Agents are creative under pressure and find loopholes.

### Address spirit-vs-letter explicitly

Add a foundational principle near the top of any discipline skill:

```
Violating the letter of this rule is violating the spirit of this rule.
```

This cuts off an entire class of "I am following the spirit" rationalizations.

### Build a Rationalization Table

Capture every excuse observed during fixture testing in the skill body:

| Excuse | Reality |
|--------|---------|
| "Just one quick fix first" | First fix sets the pattern. Do it right from the start. |
| "I will write the test after" | Untested fixes do not stick. The test proves the fix. |

Add new rows whenever a new rationalization appears. The table grows over time and is the most effective single tool for closing loopholes. See `systematic-debugging.md` for an applied example.

### Red Flags List

Make it easy for agents to self-check:

```
## Red Flags — STOP and Restart

- "Quick fix for now"
- "I will write the test after"
- ...

All of these mean: STOP. Return to Phase 1.
```

## Authoring Workflow

When adding a new agent, skill, or significantly editing one:

1. **Identify the discipline.** What rule should the agent follow that it currently ignores or violates?
2. **Write a fixture (RED).** Place at `tests/fixtures/<agent>/<NNN-descriptive-name>/`. Include `input/` files, `expected_behavior.md` (what the agent should and should not do), and `assertions.json` (machine-checkable assertions). Run via `JLU_UI_QA_PRESSURE_MODE=live` against the current agent. The fixture should fail.
3. **Write the rule (GREEN).** Add the minimum content to the agent prompt or skill body to address the specific failures from step 2. Do not add hypothetical content.
4. **Re-run the fixture.** It should pass. If not, iterate on the prompt.
5. **Refactor (close loopholes).** Inspect the agent's reasoning in the GREEN run. Did it comply for the right reasons or find a loophole? Add explicit counters for any loopholes. Re-run.
6. **Record replay transcript.** Once GREEN is stable, re-run without `JLU_UI_QA_PRESSURE_MODE=live` to write `<fixture>/replay/transcript.json`. CI runs replay mode going forward.
7. **Document in CHANGELOG.** Mention the new fixture and the rule it enforces.

## When to Skip TDD-for-Skills

Skip when:

- Pure typo or formatting fix
- Adding a citation or cross-link to an existing reference (no behavior change)
- Trimming verbose content without removing rules
- Renaming a section header

Apply when:

- Adding or removing a rule
- Changing rationalization counters
- Adding or removing a discipline gate
- Editing a skill `description` field (run through the CSO check)
- Adding a new agent or skill

## Extending the Harness

`tests/pressure/runner.mjs` currently registers two agents in `const AGENTS = [...]`. To bring TDD mode to a new agent (e.g., `jlu-implementer`, `jlu-qa-agent`):

1. Add the agent name to the `AGENTS` array in `runner.mjs`.
2. Create `tests/fixtures/<agent-short-name>/` with at minimum one fixture (`001-happy-path` or equivalent baseline).
3. Verify the harness can dispatch the agent with the same inputs the orchestrator would pass at runtime — this may require new dispatch wiring depending on the agent's tool list and context inputs.
4. Author the first failing fixture before editing the agent prompt.

Until step 1–3 land for an agent, edits to that agent's prompt rely on regression-mode confidence only — apply the methodology spirit (state the rule clearly, write rationalization tables, add red flags) even when no fixture is yet wired up.

## Authoring Checklist

**RED phase:**
- [ ] Fixture exists at `tests/fixtures/<agent>/<NNN-name>/`.
- [ ] `input/` contains the minimum scaffolding the agent needs.
- [ ] `expected_behavior.md` states what the agent MUST and MUST NOT do.
- [ ] `assertions.json` encodes expectations as machine-checkable assertions.
- [ ] Fixture run currently fails (baseline established).

**GREEN phase:**
- [ ] Prompt or skill edit addresses the specific failures observed.
- [ ] No content added for hypothetical scenarios.
- [ ] Description follows CSO (triggers only, no workflow summary).
- [ ] Token target met.
- [ ] Fixture run passes.

**REFACTOR phase:**
- [ ] Identified new rationalizations or loopholes from the GREEN run.
- [ ] Added explicit counters in the prompt.
- [ ] Rationalization table updated.
- [ ] Red flags list updated.
- [ ] Re-run passes.

**Deployment:**
- [ ] Replay transcript recorded.
- [ ] CHANGELOG entry describes the new rule.
- [ ] Both Claude (`agents/`) and OpenCode (`.opencode/agents/`) mirrors updated when editing an agent.
