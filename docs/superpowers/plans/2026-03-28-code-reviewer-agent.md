<!-- /autoplan restore point: /home/cristianp/.gstack/projects/cristian-pisco-jelou-spec-plugin/main-autoplan-restore-20260328-222441.md -->
# Plan: Code Reviewer Agent (`jlu-code-reviewer`)

## Problem

The Jelou Spec Plugin's TDD pipeline currently has a QA agent (`jlu-qa-agent`) that validates tests pass, conventions are followed, and requirements are met. But it doesn't evaluate the **quality of the design** — whether the code has code smells, whether the right software patterns were applied, or whether the implementation is over-engineered for the problem.

This means code can pass all tests and conventions checks while still being:
- Poorly structured (god classes, feature envy, long parameter lists)
- Over-engineered (unnecessary abstractions, premature generalization, complex patterns for simple problems)
- Missing appropriate patterns (raw conditionals instead of strategy pattern, scattered logic instead of proper encapsulation)

## Proposed Solution

Add a new specialized agent `jlu-code-reviewer` that reviews implementation code through the lens of software engineering and architecture best practices.

### Agent Responsibilities

1. **Code Smell Detection** — Identify structural issues:
   - God classes / large classes
   - Long methods (beyond the 100-line rule already enforced)
   - Feature envy (methods using more data from other classes than their own)
   - Data clumps (groups of data that travel together)
   - Primitive obsession
   - Long parameter lists
   - Divergent change / shotgun surgery indicators
   - Inappropriate intimacy between modules
   - Dead code / speculative generality

2. **Pattern Recommendations** — Suggest applicable patterns:
   - When raw conditionals should be strategy/state patterns
   - When scattered creation logic should use factory patterns
   - When complex object construction should use builder patterns
   - When cross-cutting concerns should use decorator/middleware patterns
   - When event-driven patterns would decouple modules

3. **Over-Engineering Detection** — Flag unnecessary complexity:
   - Abstractions with only one implementation
   - Premature generalization (configurable things that will never be configured)
   - Unnecessary indirection layers
   - Complex patterns applied to simple problems
   - Enterprise patterns in small codebases (e.g., full CQRS for a CRUD endpoint)

### Integration Point

The code reviewer would run **after the implementer's Green step and before the QA agent** in the execute-task workflow (between steps 7e and 7h). This placement ensures:
- Code is already working (tests pass)
- Review happens before QA validates conventions
- Feedback can trigger a refactor pass before committing

### Agent Definition

```yaml
---
name: jlu-code-reviewer
description: "Reviews implementation code for design quality, code smells, patterns, and over-engineering"
tools: Read, Glob, Grep
model: sonnet
---
```

**Note:** Read-only tools. This agent reviews and reports, it does NOT modify code. The implementer handles fixes based on the reviewer's findings.

### Workflow Integration

In `execute-task.md`, add a new step 7g-bis (Code Review) between current 7g (Refactor) and 7h (QA):

```
### 7g-bis. Code Review

Spawn `jlu-code-reviewer` with model: MODEL_CONFIG.code (default: sonnet):
- Input: All files modified/created in this phase
- Input: Phase requirements (for context on what problem is being solved)
- Input: ARCHITECTURE.md, CONVENTIONS.md (for codebase context)
- Task: Review implementation for code smells, pattern opportunities, and over-engineering

If the reviewer finds issues with severity HIGH or CRITICAL:
- Spawn jlu-implementer to address the findings
- Re-run tests to confirm Green is maintained
- Re-run code review to verify fixes
- Max 2 review cycles per phase (prevent infinite loops)

If only MEDIUM or LOW findings:
- Log to phase file for documentation
- Continue to QA step
```

### Output Format

```markdown
## Code Review Report — Phase <N>

### Status: CLEAN | HAS_FINDINGS

### Code Smells
| ID | Smell | Location | Severity | Recommendation |
|----|-------|----------|----------|----------------|
| CS-1 | Long method | `src/auth.service.ts:45-180` | HIGH | Extract validation logic into separate method |

### Pattern Opportunities
| ID | Current Code | Suggested Pattern | Rationale | Effort |
|----|-------------|-------------------|-----------|--------|
| PO-1 | Switch on type | Strategy pattern | 3+ type variants, likely to grow | LOW |

### Over-Engineering Alerts
| ID | Issue | Location | Recommendation |
|----|-------|----------|----------------|
| OE-1 | Interface with single impl | `src/interfaces/IProcessor.ts` | Remove interface, use concrete class directly |

### Summary
- Code smells found: N (H high, M medium, L low)
- Pattern opportunities: N
- Over-engineering alerts: N
- Recommended action: REFACTOR | ACCEPT_AS_IS
```

### Model Tier

- Default: `sonnet` (same as implementer and QA)
- Configurable via `.spec-workspace.json` under `models.code` group (shares with test-writer, implementer, QA)

### Impact on Existing Workflow

- Adds ~30-60 seconds per phase (one agent spawn + code analysis)
- Does not change the TDD Red-Green-Refactor cycle fundamentally
- Non-blocking for MEDIUM/LOW findings (only HIGH/CRITICAL trigger refactor)
- Phase files get enriched with code quality documentation

## Phases

### Phase 01: Agent Definition
- Create `agents/jlu-code-reviewer.md` with full agent specification
- Define the review checklist, severity classification, output format
- Service: jelou-spec-plugin (this repo)

### Phase 02: Workflow Integration
- Modify `jelou/workflows/execute-task.md` to add step 7g-bis
- Add code review dispatch logic with retry loop (max 2 cycles)
- Handle the review-then-fix-then-re-review flow
- Service: jelou-spec-plugin (this repo)

### Phase 03: Model Configuration
- Ensure `jlu-code-reviewer` respects MODEL_CONFIG.code from `.spec-workspace.json`
- Add documentation for the new agent in README.md
- Service: jelou-spec-plugin (this repo)

## Risks

| Risk | Mitigation |
|------|-----------|
| Agent hallucinating code smells that don't exist | Require specific file:line references for every finding; QA agent cross-validates |
| Over-engineering the reviewer itself (ironic) | Keep agent simple — checklist-based review, no fancy analysis |
| Slowing down the pipeline significantly | Non-blocking for LOW/MEDIUM; time-box review to 60 seconds |
| Review-fix loop never converging | Hard cap at 2 review cycles per phase |
| Conflicting advice with QA agent | Clear scope separation: reviewer = design quality, QA = functional correctness + conventions |

## Questions to Resolve

1. Should the code reviewer run on EVERY phase or only on phases above a certain file count threshold?
2. Should findings be persisted to TASKS.md or only to phase files?
3. Should the agent have access to the full codebase (Glob/Grep) or only the modified files?

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|---------------|-----------|-----------|----------|
| 1 | CEO | Mode: SELECTIVE EXPANSION | Mechanical | P1+P3 | Viability assessment needs scope challenge + targeted expansions | N/A |
| 2 | CEO | Approach B (expand QA) recommended over Approach A (new agent) | Taste | P5+P3 | Simpler, DRY, consistent with v0.3.0 direction. Close call with A. | Approach A (new agent) |
| 3 | CEO | Pattern recommendations section should be removed or advisory-only | Mechanical | P5 | Internal contradiction: recommending patterns while detecting over-engineering | Pattern recommendations as pipeline-blocking |
| 4 | CEO | Per-phase review replaced with final-validation-only | Mechanical | P3+P5 | Both voices agree per-phase misses architecture issues while adding latency | Per-phase execution |
| 5 | CEO | Advisory-only mode required before blocking mode | Mechanical | P6 | False positive rate unknown; need data before gating pipeline | Immediate pipeline-blocking |
| 6 | CEO | Success metrics required before implementation | Mechanical | P1 | No way to validate the agent works without measurable targets | Build first, measure later |
| 7 | CEO | Kill switch via .spec-workspace.json | Mechanical | P3 | Easy rollback if agent is net negative | No kill switch |
| 8 | Eng | Severity rubric required before implementation | Mechanical | P5 | Gating mechanism is undefined without severity criteria | Undefined severity |
| 9 | Eng | Total review budget across phases (if per-phase kept) | Mechanical | P3 | Prevents 2N extra spawns compounding across N phases | Per-phase cap only |
| 10 | Eng | Implementer needs "refactor mode" prompt for reviewer findings | Mechanical | P5 | Current implementer mandate conflicts with design feedback | Assume implementer accepts |
| 11 | Eng | Golden-file evaluation before deployment | Mechanical | P1 | No testability path for prompt-based agent | Ship without validation |
| 12 | Eng | Define error paths: timeout, crash, false positive | Mechanical | P1 | 4 undefined paths in codepath map | Undefined error handling |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_open | 4 premises rejected, 3 alternatives identified, scope reduction recommended |
| CEO Voices | Codex + Claude subagent | Independent strategic challenge | 1 | issues_found | 6/6 consensus: reject plan as written |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | issues_open | 7 findings (4 HIGH, 3 MEDIUM), 4 undefined error paths |
| Eng Voices | Codex + Claude subagent | Independent architecture challenge | 1 | issues_found | 6/6 consensus: reject plan as written |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | skipped | No UI scope detected |

**VERDICT:** PLAN REJECTED BY ALL 4 VOICES.

**FINAL DECISION (2026-03-28): APPROACH A — Expand jlu-qa-agent.**
User approved expanding the existing QA agent's final validation (step 8) with code smell detection and over-engineering detection sections. No new agent. No per-phase review. No pattern recommendations. Aligned with v0.3.0 simplification direction.
