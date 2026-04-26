# Architecture Review Skill — Design

> Status: Draft for plan
> Date: 2026-04-26
> Inspired by: [matt-pocock/skills/improve-codebase-architecture](https://github.com/mattpocock/skills/tree/main/improve-codebase-architecture)
> Companion to: [Ubiquitous Language Skill — Design](2026-04-26-ubiquitous-language-design.md)

## Goal

Add a `/jlu-architecture-review` command (and supporting agents) that surfaces **deepening opportunities** in a service or across services — refactors that turn shallow modules into deep ones, in service of testability and AI-navigability. The skill explores, presents a numbered candidate list, then drops into an interactive grilling loop on the user's selected candidate, lazily recording **ADRs** when candidates are rejected with load-bearing reasons.

The skill is informed by — but never edits — the canonical `UBIQUITOUS_LANGUAGE.md` glossary (read-only, like Hook B of the ubiquitous-language design). It uses domain terms from the glossary to *name* candidates, and uses a separate **architecture vocabulary** (Module, Interface, Seam, Adapter, Depth, Leverage, Locality) to *describe* them.

The first user of this skill is the plugin itself: applying `/jlu-architecture-review` to `jelou-spec-plugin` is the acceptance test.

## Constraints (decided during brainstorm)

| Decision | Choice |
|----------|--------|
| Target | Dogfood the plugin first; ship as a consumer feature once at least one self-applied refactor lands |
| Knowledge inputs | Reads existing 6 codebase knowledge files + `UBIQUITOUS_LANGUAGE.md` (read-only). Writes ADRs as a new workspace artifact |
| Lifecycle placement | Standalone command. Soft hand-off to `/jlu-new-task` via copy-paste. No auto-flow |
| Scope | `<service-id>` arg = single-service mode. `--cross-service` flag = workspace-wide pass for cross-seam refactors |
| Depth | Explore → Present numbered candidates → Grilling loop. **No** parallel interface-design sub-agents (delegated to `proposal-agent` once a task is created) |
| ADR storage | Workspace-level `<workspace>/decisions/ADR-NNNN-<slug>.md`, mirroring how the glossary lives at the workspace level |
| Vocabulary contract | Pocock's LANGUAGE.md, adapted, shipped as `jelou/references/architecture-language.md`. Both agents required to use these terms exactly |
| Agent tier | Explorer = Sonnet (research/synthesis tier). Grill = Opus (interactive interview tier — matches `spec-interviewer`) |

## File Layout

**Plugin repo (`jelou-spec-plugin`):**

```
jelou-spec-plugin/
├── skills/
│   └── architecture-review/
│       └── SKILL.md                                 # NEW — /jlu-architecture-review launcher
├── agents/
│   ├── jlu-architecture-explorer.md                 # NEW — code-only candidate discovery (sonnet)
│   └── jlu-architecture-grill.md                    # NEW — interactive grilling loop + ADR offers (opus)
└── jelou/
    ├── workflows/
    │   └── architecture-review.md                   # NEW — orchestrator (single + cross-service modes)
    ├── templates/
    │   ├── architecture-review.md                   # NEW — reference shape for the candidates report
    │   └── adr.md                                   # NEW — ADR file template
    └── references/
        └── architecture-language.md                 # NEW — vocabulary contract (Pocock's LANGUAGE.md, adapted)
```

**Workspace artifacts (target project's `.spec-workspace/`):**

```
.spec-workspace/
├── decisions/                                       # NEW — workspace-level ADR home
│   ├── ADR-0001-<slug>.md
│   └── ADR-NNNN-<slug>.md
└── services/
    └── <service-id>/
        codebase/
          ARCHITECTURE_REVIEW.md                     # NEW — last single-service report (overwritten each run)
          ARCHITECTURE_REVIEW.cross-service.md       # NEW — cross-service report (only when --cross-service was last used)
```

A separate `decisions/` directory keeps ADRs at the workspace level, parallel to `glossary/`. Cross-service decisions live there naturally; single-service decisions carry a `service: <id>` frontmatter field.

The candidates report files live alongside the per-service codebase files. They are **transient** — overwritten on each run. Surviving briefs that the user wants to keep become tasks under `specs/`.

## Vocabulary Contract

### Architecture vocabulary (`jelou/references/architecture-language.md`)

Both agents MUST use these terms exactly. Near-verbatim port of Pocock's `LANGUAGE.md`, with one adaptation noted below.

**Terms.**

- **Module** — anything with an interface and an implementation (function, class, package, slice).
  *Avoid: unit, component, service.*
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
  *Avoid: API, signature.*
- **Implementation** — the code inside.
- **Depth** — leverage at the interface. **Deep** = high leverage; **Shallow** = interface nearly as complex as the implementation.
- **Seam** *(from Michael Feathers)* — where an interface lives; a place where behaviour can be altered without editing in place.
  *Avoid: boundary (overloaded with DDD's bounded context).*
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

**Plugin adaptation.** In this plugin, "service" refers to a deployment unit (a repo/codebase managed by `services.yaml`). Inside service code, never use "service" as a module name — say Module, Adapter, or name the concept from `UBIQUITOUS_LANGUAGE.md`.

**Principles.**

- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam.
- **One adapter = hypothetical seam. Two adapters = real seam.** Don't introduce a port unless something actually varies across it.
- **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small, mockable parts — they just aren't part of the interface.

**Rejected framings (do not adopt).**

- Depth as a ratio of implementation-lines to interface-lines (rewards padding).
- "Interface" as the TypeScript `interface` keyword or a class's public methods (too narrow).
- "Boundary" (overloaded with DDD).

### Domain vocabulary (read-only)

The skill consumes `<workspace>/glossary/UBIQUITOUS_LANGUAGE.md` (produced by the ubiquitous-language skill — see [companion design](2026-04-26-ubiquitous-language-design.md)). Candidates and ADRs name domain concepts using canonical terms from the glossary. The skill **never edits** the glossary.

If the explorer surfaces a concept that isn't in the glossary, the candidate carries `missing_domain_term: <proposed-name>`. The grill agent may, with user consent, append the term to a `## Terms surfaced during architecture review` section in the candidates report — for the next `/jlu-ubiquitous-language` run to consume. Same separation-of-concerns principle as Hook B in the ubiquitous-language design.

## Artifact Schemas

### `ARCHITECTURE_REVIEW.md` (per-service report — transient)

```markdown
# Architecture Review — <service-id>

> Generated by `/jlu-architecture-review` on <date>. Mode: <single|cross>.
> This report is transient — it is overwritten on each run. Briefs you want to keep should become tasks in `specs/`.

## Candidates

### #1: <Concept-named module name>
- **Files**: <list>
- **Problem**: <2–3 sentences using ARCH_VOCAB>
- **Solution**: <plain-English description>
- **Benefits**:
  - **Leverage**: <what callers gain>
  - **Locality**: <where change concentrates>
  - **Tests**: <how the test surface improves>
- **Dependency category**: <in-process | local-substitutable | remote-but-owned | true-external>
- **Deletion test**: <one sentence>
- **Confidence**: <high|medium|low>
- *Optional flags:* `missing_domain_term: <name>`, `contradicts_adr: ADR-NNNN`

### #2: ...

## Grilled candidates

### #<N>: <title>  (status: ready for /jlu-new-task)
- **Files**: <list>
- **Problem**: <copied/refined from explorer>
- **Proposed seam**: <one paragraph>
- **Dependency category**: <category>
- **Test surface after deepening**: <one paragraph>
- **Open questions surfaced during grilling**: <bullets>

## Rejections

- #N <title>: discarded — <one-line reason>
- #N <title>: recorded as ADR-NNNN — <link>

## Terms surfaced during architecture review

> Run /jlu-ubiquitous-language to canonicalize these.

- <TermName> — <proposed one-sentence definition>
```

### `ADR-NNNN-<slug>.md` (workspace-level, append-only)

Frontmatter + body, per `jelou/templates/adr.md`:

```markdown
---
id: ADR-<NNNN>
slug: <kebab-case-slug>
title: <one-line title>
status: accepted | superseded | deprecated
date: <YYYY-MM-DD>
service: <service-id> | workspace
supersedes: ADR-<NNNN> | null
superseded_by: ADR-<NNNN> | null
tags: [<keyword>, ...]
---

# <Title>

## Context
<2–4 sentences using ARCH_VOCAB and DOMAIN_TERMS.>

## Decision
<2–3 sentences. Includes "do nothing" / "reject the proposal" framings.>

## Consequences
<1–2 paragraphs.>

## Load-bearing reason for future explorers
<MUST be filled in for rejection ADRs. Phrased so a fresh explorer with no conversation context can read it and skip the candidate.>
```

**Numbering.** Global, workspace-level, zero-padded to 4 digits. Allocated by the orchestrator before dispatching the grill (scan `<workspace>/decisions/` for max ID, increment). The grill receives the pre-allocated number; never invents one.

### Explorer fragment (intermediate, not user-facing)

`<workspace>/.tmp/architecture/<service-id>.candidates.json` — written by explorer, read by orchestrator for rendering, deleted after `ARCHITECTURE_REVIEW.md` is written.

```json
{
  "mode": "single|cross",
  "scope": ["<service-id>", "..."],
  "scanned_at": "<ISO datetime>",
  "candidates": [
    {
      "id": 1,
      "title": "<Concept-named module name from DOMAIN_TERMS>",
      "files": ["src/<...>", "..."],
      "problem": "<2-3 sentences using ARCH_VOCAB>",
      "solution": "<plain-English description>",
      "benefits": {
        "leverage": "<what callers gain>",
        "locality": "<where change/bugs concentrate>",
        "tests": "<how the test surface improves>"
      },
      "dependency_category": "in-process | local-substitutable | remote-but-owned | true-external",
      "missing_domain_term": "<proposed-name>",
      "contradicts_adr": "ADR-NNNN",
      "deletion_test": "<one sentence>",
      "confidence": "high|medium|low"
    }
  ]
}
```

## Standalone Workflow `/jlu-architecture-review`

`jelou/workflows/architecture-review.md`, dispatched from `SKILL.md` (same launcher pattern as `/jlu-map-codebase` and `/jlu-ubiquitous-language`).

### Step 1 — Resolve workspace

- Read `.spec-workspace.json` from CWD; resolve `WORKSPACE_PATH`.
- If missing, search up to 5 parents for `.spec-workspace/`. If still missing: `"/jlu-architecture-review requires a .spec-workspace/. Run /jlu-map-codebase first."`
- Verify `.spec-workspace/registry/services.yaml` exists.

### Step 2 — Resolve mode and scope

- `<service-id>` arg, no `--cross-service` → `MODE=single`, scope = one service.
- `--cross-service` flag, no arg → `MODE=cross`, scope = all services in `services.yaml` that have `codebase/` files.
- `--cross-service` + `<service-id>` → `MODE=cross`, scope = the named service plus services it integrates with (derived from `INTEGRATIONS.md`).
- No args → error: `"Pass <service-id> for single-service mode, or --cross-service for workspace mode."`
- Cross-service degenerate case (only one service in scope) → degrade to single-service with a warning.

Store: `SCOPED_SERVICES`, `MODE`.

### Step 3 — Load knowledge files (read-only)

For each service in `SCOPED_SERVICES`:

- Verify `codebase/` directory exists with the 6 knowledge files. If missing for any in-scope service: stop with `"Service <id> not yet mapped. Run /jlu-map-codebase <id> first."`
- Load `ARCHITECTURE.md`, `STRUCTURE.md`, `INTEGRATIONS.md`, `CONVENTIONS.md`, `CONCERNS.md`. (Skip `STACK.md` — not relevant to depth analysis.)

Workspace-level:

- Load `glossary/UBIQUITOUS_LANGUAGE.md` if present → `DOMAIN_TERMS`. If absent, `DOMAIN_TERMS = []` and the final summary suggests running `/jlu-ubiquitous-language`.
- Glob `decisions/ADR-*.md` → `EXISTING_ADRS`. Filter by service: in `MODE=single`, keep only ADRs with `service: <id>` or `service: workspace`. In `MODE=cross`, keep ADRs with `service: workspace` plus ADRs scoped to any in-scope service.
- Load `jelou/references/architecture-language.md` → `ARCH_VOCAB`.

### Step 4 — Dispatch explorer

One `jlu-architecture-explorer` agent (model: `sonnet`). Inputs:

- `MODE`
- `SCOPED_SERVICES` (list of `{id, source_root, codebase_dir}`)
- All loaded knowledge files
- `DOMAIN_TERMS`
- `EXISTING_ADRS`
- `ARCH_VOCAB`
- `OUTPUT_FRAGMENT` (`<workspace>/.tmp/architecture/<service-id>.candidates.json` or `<workspace>/.tmp/architecture/cross-<date>.candidates.json`)

Single dispatch — not parallel-per-service even in `MODE=cross`. Cross-service analysis is inherently joined; splitting it would lose the seam-finding payoff.

### Step 5 — Render candidates report and prompt

- Read fragment, render markdown into `ARCHITECTURE_REVIEW.md` (single mode) or `ARCHITECTURE_REVIEW.cross-service.md` (cross mode) under each in-scope service's `codebase/`.
- Delete fragment.
- Display the candidate list to the user via `AskUserQuestion`:
  ```
  Candidates for <service-id>:
    1. <title> — <one-line problem>
    2. ...
  What next?
    [Pick #N]   walk through this candidate (grilling loop)
    [Done]      exit; report file is saved at <path>
  ```

### Step 6 — Grilling loop (only if user picks)

- Pre-allocate next ADR number by scanning `<workspace>/decisions/`. Increment max → `NEXT_ADR_NUMBER`.
- Dispatch `jlu-architecture-grill` agent (model: `opus`). Inputs:
  - Selected candidate (full record from fragment)
  - All knowledge files for context
  - `DOMAIN_TERMS`
  - `EXISTING_ADRS`
  - `ARCH_VOCAB`
  - `REPORT_PATH`
  - `ADR_DIR` (`<workspace>/decisions/`)
  - `NEXT_ADR_NUMBER`

The grill agent owns all subsequent user interaction. The orchestrator does not intervene until the grill returns.

Grill outcomes (the agent writes one of):

- **Survives** — appends a brief to `## Grilled candidates` in `REPORT_PATH`.
- **Rejected with load-bearing reason** — writes `<ADR_DIR>/ADR-<NEXT_ADR_NUMBER>-<slug>.md`; appends a `## Rejections` link in `REPORT_PATH`.
- **Rejected casually** — single line under `## Rejections` in `REPORT_PATH`.

### Step 7 — Loop or exit

After each grill cycle, return to Step 5's question (`Pick #N` / `Done`) until the user picks `Done`.

### Step 8 — Final summary

```
## Architecture Review Complete
- Mode: single | cross-service
- Candidates surfaced: N
- Grilled: M (K survived, J rejected, I recorded as ADRs)
- Report: <path>
- ADRs created: <list of ADR files>

To turn a survived candidate into a task:
    /jlu-new-task
    [paste candidate brief from <path>#grilled-candidates as the seed]
```

### Workflow rules

- **Single explorer dispatch.** Cross-service analysis is joined; per-service parallelism would lose seam discovery.
- **Grill owns user interaction.** Orchestrator dispatches and waits.
- **Re-run is idempotent.** Reports are overwritten; ADRs are append-only.
- **ADR numbers are global**, not per-service.
- **No auto-hooks.** Standalone only — the grilling loop is too heavy and conversational to bolt onto another command.

## Explorer Agent — `jlu-architecture-explorer`

```
agents/jlu-architecture-explorer.md
---
name: jlu-architecture-explorer
description: Walks a service (or service set) and surfaces deepening candidates. Code-only, no user interview.
tools: Read, Glob, Grep, Bash, Agent
model: sonnet
---
```

### Mission

Read knowledge files, walk source code via `Explore` sub-agents, apply the deletion test, emit a flat candidate list. No user interaction.

### Inputs

- `MODE` — `single` or `cross`
- `SCOPED_SERVICES` — list of `{id, source_root, codebase_dir}`
- All loaded knowledge files
- `DOMAIN_TERMS` — parsed from `UBIQUITOUS_LANGUAGE.md` (may be empty)
- `EXISTING_ADRS` — list of `{id, slug, summary, rejected_proposal, load_bearing_reason}`
- `ARCH_VOCAB` — full text of `architecture-language.md`
- `OUTPUT_FRAGMENT` — absolute path to write candidate fragment

### Behavioral guardrails

- **Use `ARCH_VOCAB` terms exactly** — Module, Interface, Seam, Adapter, Depth, Leverage, Locality. Never substitute "component," "service," "API," or "boundary" inside candidate text. ("Service" the deployment unit is fine; "service" as a module name is not.)
- **Use `DOMAIN_TERMS` to name candidates.** A candidate operating on the Order concept is "the Order intake module" — never "OrderHandler" or "OrderService." If the relevant concept is not in `DOMAIN_TERMS`, name it descriptively and flag `missing_domain_term`.
- **Apply the deletion test** to anything you suspect is shallow.
- **Do NOT re-litigate ADRs.** Before emitting, check candidate against `EXISTING_ADRS`. If it matches a rejected proposal, omit it unless the friction is materially worse than the ADR captured — in that case, emit and tag `contradicts_adr: ADR-NNNN`.
- **Maximum 7 candidates per run.** Rank by friction-impact-to-effort ratio.
- **No interface designs.** Output is candidates only — no method signatures, no type declarations.

### Discovery strategy

1. Read all knowledge files first; build a mental map.
2. Dispatch `Explore` sub-agents (thoroughness=`medium`) to walk source for friction signals:
   - Shallow modules — interface complexity ≈ implementation complexity.
   - Tight coupling across what should be a seam.
   - Pure functions extracted only for testability, with no **locality** payoff (real bugs hide in how they're called).
   - Untested-but-load-bearing code paths.
   - Modules that, if deleted, would concentrate complexity rather than scatter it.
3. For `MODE=cross`: prioritize friction at integration points. Read each `INTEGRATIONS.md` and trace contracts; look for ports that are de-facto shared but defined N times across services.

### Confidence scoring

- `high` — friction signal corroborated across ≥2 independent sources (e.g., a shallow module also flagged in `CONCERNS.md`).
- `medium` — clearly observable in code, no corroborating doc.
- `low` — heuristic-only; defensible but speculative.

### Self-check before submitting

- [ ] Every candidate uses `ARCH_VOCAB` terms exactly.
- [ ] Every candidate names its concept from `DOMAIN_TERMS`, or carries `missing_domain_term`.
- [ ] Every candidate has a deletion-test sentence.
- [ ] ≤ 7 candidates total.
- [ ] No candidate that fully matches a rejected ADR (without `contradicts_adr` tag).
- [ ] No interface signatures in any candidate body.

## Grill Agent — `jlu-architecture-grill`

```
agents/jlu-architecture-grill.md
---
name: jlu-architecture-grill
description: Walks the design tree on a single deepening candidate with the user. Bounded interview, lazy ADR offer on rejection, refined brief on survival.
tools: Read, Write, Edit, Glob, Grep, AskUserQuestion
model: opus
---
```

### Mission

Stress-test one candidate with the user. Surface constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive. Outcomes: **survives** (refined brief written), **rejected with reason** (ADR offered), **rejected casually** (just noted).

### Inputs

- Selected candidate (full record from explorer fragment)
- Knowledge files for context
- `DOMAIN_TERMS`
- `EXISTING_ADRS`
- `ARCH_VOCAB`
- `REPORT_PATH`
- `ADR_DIR`
- `NEXT_ADR_NUMBER`

### Behavioral guardrails

- **Maximum 6 questions across the whole grilling loop.** Stress-test, not interview.
- **Use `ARCH_VOCAB` terms exactly.**
- **Never propose interfaces.** Interface design is `proposal-agent`'s job once a task is created. The grill produces a *brief*, not a design.
- **Lazy ADR offer.** Only offer to record an ADR when the user rejects with a *load-bearing reason* — a reason a future explorer would need in order to not re-suggest the same candidate.
- **Lazy domain-term capture.** If a missing term crystallizes during the conversation (user agrees on a name + one-sentence definition), offer to flag it for the next `/jlu-ubiquitous-language` run. Append to a `## Terms surfaced during architecture review` section in `REPORT_PATH`. **Never edits the canonical glossary directly.**

### Phase 1 — Frame

Re-read the candidate. Read knowledge files focused on the candidate's `files`. Build an internal model: dependency graph, current test surface, callers.

### Phase 2 — Grill

Ask up to 6 questions via `AskUserQuestion`, prioritized:

1. **Constraint check** — "Is there a constraint I'm missing that makes this seam impractical (perf, deploy boundary, team ownership)?"
2. **Dependency category sanity** — confirm the explorer's `dependency_category`. If `remote-but-owned`, ask which service owns the logic.
3. **Test surface** — "What tests live on these files today? What dies if we move them behind the new interface?"
4. **Survival of pre-existing ADRs** — only if `contradicts_adr` is set: "ADR-NNNN rejected this previously because <reason>. Has the situation changed?"
5. **Scope shape** — "Single deepening or chain (e.g., merge A+B first, then deepen further)?"
6. **Pull the trigger** — "Do you want this captured as a refactor task, or rejected?"

Stop early if the user says "skip" / "good enough" / "just capture it."

### Phase 3 — Outcome

- **Survives** — append to `REPORT_PATH` under `## Grilled candidates` (schema in Artifact Schemas).
- **Rejected with load-bearing reason** — write `<ADR_DIR>/ADR-<NEXT_ADR_NUMBER>-<slug>.md` (atomic: write to `.tmp` then rename). Append link in `REPORT_PATH` under `## Rejections`.
- **Rejected casually** — single line under `## Rejections`: `- #N <title>: discarded — <one-line reason>`.

### Phase 4 — Free-text feedback handling

If during grilling the user gives free-text instructions ("the seam should be at X, not Y"), apply them directly to the in-progress brief. Do not loop back through structured questions if the user has already specified the answer.

### Self-check before returning

- [ ] Either a brief was appended, or a rejection was recorded.
- [ ] No interface signatures (types, methods) written.
- [ ] `ARCH_VOCAB` used; no "component" / "boundary" / "API" leaks.
- [ ] If an ADR was written: it has the load-bearing reason in the body, not just "user said no."
- [ ] If a domain term was captured: it lives in the report, not the canonical glossary.

## ADR Template — `jelou/templates/adr.md`

Schema in Artifact Schemas section above. Template is the literal frontmatter + body, with placeholders. The grill agent fills it; the orchestrator never touches it.

**Key rules:**

- **`service` field**: `<service-id>` for single-service decisions, `workspace` for cross-service decisions. Filter logic in workflow Step 3 uses this.
- **`status` field**: defaults to `accepted`. Future supersession is signaled by writing a new ADR with `supersedes: ADR-NNNN` and the original ADR's `superseded_by` field updated.
- **No supersession-chain validation** in v1 — workspace integrity is the user's responsibility.

## Edge Cases & Error Handling

| Situation | Handling |
|-----------|----------|
| `.spec-workspace/` missing | Stop with `"/jlu-architecture-review requires a .spec-workspace/. Run /jlu-map-codebase first."` |
| Service has no `codebase/` knowledge files | Stop with `"Service <id> not yet mapped. Run /jlu-map-codebase <id> first."` Do NOT auto-run map-codebase |
| `UBIQUITOUS_LANGUAGE.md` missing | Run anyway. Explorer flags every concept-named candidate with `missing_domain_term`. Final summary suggests running `/jlu-ubiquitous-language` |
| `<workspace>/decisions/` missing | Create lazily on first ADR write. No-op until then |
| `--cross-service` with only one service in scope | Degrade to single-service mode with a warning |
| Explorer agent fails | Report failure; no partial fragment; no report file written; exit non-zero. Re-run is idempotent |
| Grill agent fails mid-loop | Whatever was already written to `REPORT_PATH` survives. ADR file is written atomically (write to `.tmp` then rename). User can re-pick the candidate from the report's pre-grilling section |
| User picks a candidate, then cancels | No write to `## Grilled candidates`. Numbered list remains in `REPORT_PATH`. Skill returns to Step 5 question |
| Re-run on same service while a previous report exists | Overwrite. The report is transient |
| ADR number collision (concurrent runs) | Out of scope for v1. Document: "do not run concurrently" |
| User rejects a candidate that exactly matches an existing ADR | Grill detects this from `EXISTING_ADRS`, asks: `"This matches ADR-NNNN. Re-affirm the existing ADR (no new file) or supersede with new reasoning?"` Default: re-affirm, no new ADR |

## Dogfood Plan

Apply this skill to `jelou-spec-plugin` itself before shipping it as a consumer feature. The dogfood pass is the **acceptance test**.

1. **Treat the plugin as its own workspace.** Create `.spec-workspace/` at the plugin repo root with one entry in `services.yaml`:
   ```yaml
   services:
     - id: jelou-spec-plugin
       path: .
       stack: shell-bash + claude-skills
   ```
2. **Run `/jlu-map-codebase jelou-spec-plugin`** to produce the 6 knowledge files. If `map-codebase` can't analyze a Claude-skills repo cleanly, that's a finding before this skill ships.
3. **Run `/jlu-ubiquitous-language jelou-spec-plugin`** if implemented by then; otherwise the architecture review runs without `DOMAIN_TERMS` (handled gracefully — see Edge Cases).
4. **Run `/jlu-architecture-review jelou-spec-plugin`** in single-service mode. Friction we already suspect:
   - Plugin-resolution logic duplicated across workflow and skill files — likely a shallow-module candidate.
   - `.opencode/commands/` and `skills/` carry parallel command definitions — possible shallow seam candidate.
   - The `update-check.md` reference invoked from every workflow — likely deep already, but worth confirming.
5. **For each grilled candidate that survives:** run `/jlu-new-task` with the brief, execute the refactor, ship it. Any rejected candidates with load-bearing reasons become the first real ADRs in `<workspace>/decisions/`.
6. **Document the self-application as the worked example** in `skills/architecture-review/SKILL.md` — referencing the resulting ADRs and merged refactors.

Ship date for v1 is "after at least one survived candidate has been turned into a merged refactor PR via this flow."

## Testing Strategy

The plan will define test phases. The design implies these test surfaces:

- **Explorer unit tests** — against fixture services with known shallow modules (e.g., a pass-through wrapper, an extracted-for-testability pure function with no locality). Assert candidate output identifies them; assert `ARCH_VOCAB` is used; assert generic-vocabulary terms are not present.
- **Explorer reject-list tests** — assert candidates are not emitted for modules that fully match a rejected ADR (without `contradicts_adr` tag).
- **Explorer cross-service tests** — fixture with two services sharing a port defined twice; assert one cross-seam candidate is emitted.
- **Orchestrator workflow tests** — Step 2 mode resolution, Step 3 ADR filtering by service, Step 5 fragment-to-report rendering, Step 6 ADR number pre-allocation.
- **Grill ADR-write tests** — simulate "rejected with load-bearing reason" path; assert ADR file is written atomically with the pre-allocated number; assert `REPORT_PATH` is updated; assert `EXISTING_ADRS` is not mutated mid-run.
- **Grill domain-term-capture tests** — simulate a grill where a new term crystallizes; assert it lands in `REPORT_PATH` and not in `UBIQUITOUS_LANGUAGE.md`.
- **Vocabulary-leak tests** — golden-file tests on agent prompts: assert any output containing "component," "boundary," or "API" inside candidate/brief/ADR body fails the self-check.
- **Dogfood acceptance test** — full end-to-end run on `jelou-spec-plugin` itself, recorded as a fixture.

## Out of Scope (deferred)

- **Parallel interface-design sub-agents** (Pocock's `INTERFACE-DESIGN.md`). Belongs to `proposal-agent` after `/jlu-new-task`.
- **Auto-flow into `/jlu-new-task`.** Tighter coupling defeats the grilling-as-quality-gate principle.
- **ADR supersession-chain validation.** No enforcement of `supersedes`/`superseded_by` graph integrity.
- **ADR search command.** No `/jlu-decisions lookup <keyword>`.
- **Concurrency lock** for parallel `/jlu-architecture-review` runs.
- **Per-service ADR namespacing.** All ADRs share one global numbering scheme — simpler.
- **PR-creation hook.** No integration with `/jlu-create-pr` to auto-link ADRs in the PR body.
- **Spec-reviewer hook.** Future enhancement: have `jlu-spec-reviewer` warn when a SPEC.md proposes a refactor that contradicts an `EXISTING_ADRS`.
- **Cross-service deepening dependency modeling.** If candidate A in service-X depends on candidate B in service-Y being deepened first, the skill surfaces both as separate candidates but doesn't model the dependency. The user must sequence the tasks.

## Why This Shape

- **Two-agent split** matches the `extractor` / `curator` split in the ubiquitous-language design and the `structural` / `operational` analyzer split in `/jlu-map-codebase`. Familiar to readers of the plugin.
- **Tier discipline** — Sonnet for research/synthesis (explorer), Opus for interactive judgment (grill) — follows the plugin's existing `spec-interviewer`-vs-`proposal-agent` split. New agents fit existing slots; no new patterns invented.
- **Single explorer dispatch** (not parallel-per-service) preserves the cross-service seam-finding payoff. Per-service parallelism is the wrong shape for joined analysis.
- **Standalone (no auto-hooks)** keeps the grilling loop where it works best — in a focused, conversational session, not bolted onto a batch command.
- **Workspace-level decisions** mirror workspace-level glossary. Two parallel artifacts, same lifecycle pattern.
- **Vocabulary contract** in a single shared reference file (`architecture-language.md`) keeps both agents aligned and makes the contract changeable in one place.
- **Lazy ADR creation** prevents the rejection log from drowning in noise. Only load-bearing reasons get persisted; ephemeral rejections are reported and forgotten.
- **Read-only consumption of `UBIQUITOUS_LANGUAGE.md`** preserves the ubiquitous-language design's review-gate discipline. This skill is a *consumer* of the canonical glossary, not a co-author.
- **Dogfood-first ship gate** ensures the plugin's own architecture is evidence that the skill works before consumers see it.
