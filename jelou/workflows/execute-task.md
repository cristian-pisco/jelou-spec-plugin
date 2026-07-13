# Workflow: execute-task

> Orchestrator workflow for `/jlu-execute-task [task-slug]`
> Runs TDD implementation with proposal generation, phase-by-phase execution, and QA validation.

> **Execution policy**: This workflow runs fully autonomous. The ONLY case where execution pauses for user input is after 5 failed retry attempts on a phase or build step. All other decisions are auto-resolved.

> **SQL Safety Gate**: inject the block from `jelou/references/sql-safety.md` into every Bash-capable agent prompt (test-writer, implementer, qa-agent, build-validator).

---

## Principles

> **Minimum viable work. Verify before proceeding. Escalate before guessing.**

- Each phase follows strict TDD: Red -> Green -> Refactor. No shortcuts.
- Agents write the minimum code to satisfy tests. Over-engineering is a defect.
- Every phase must end with verified green tests before the next phase starts.
- When something fails after 5 retries, escalate to the user — don't hack around it.
- When the process feels heavy for a trivial change, that's by design. The discipline prevents drift.

**When to simplify:** For single-file, single-function changes with no cross-service impact, the orchestrator may consolidate multiple phases into one if PROPOSAL.md supports it. The TDD cycle within each phase is never skipped.

---

## Step 0.5 — Trace bootstrap

> **Tracing tolerance**: Every `trace-start-span.mjs` invocation captures stdout JSON. When `TRACE_DISABLED=1` (env var or `.spec-workspace.json: tracing.enabled: false`), every span_id is an empty string. Downstream `trace-end-span.mjs` calls and `jq` lookups must tolerate empty values without failing the workflow.

1. **Sweep orphans from any prior interrupted run** (idempotent — safe when the store is empty):
   ```bash
   node "${PLUGIN_ROOT:-.}/bin/trace-reconcile.mjs"
   ```
   The output line `reconciled: <N>` is informational. Do not fail the workflow if this script exits non-zero — tracing is best-effort.

2. **Open the workflow-level span** (deferred to the end of Step 1 when `$TASK_SLUG` is known):
   ```bash
   WF_OUT=$(node "${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs" \
     --name execute_task --scope task --task "$TASK_SLUG")
   WORKFLOW_SPAN_ID=$(echo "$WF_OUT" | jq -r '.span_id // ""')
   WORKFLOW_TRACE_ID=$(echo "$WF_OUT" | jq -r '.trace_id // ""')
   ```

   Store `WORKFLOW_SPAN_ID` and `WORKFLOW_TRACE_ID` for the duration of the workflow. Empty strings are valid when `TRACE_DISABLED=1`.

### Step 0.5b — Surface suggestions from prior runs

Run the suggester. It scans recent trace history and emits one SUGGEST block per active rule that fires (4 possible rules: bump model tier, extend failure patterns, suggest parallelization, immediate flag on blocked spans). The 7-day cooldown is honored automatically.

```bash
SUGGESTIONS=$(node "${PLUGIN_ROOT:-.}/bin/trace-suggest.mjs" 2>/dev/null || true)
```

If `SUGGESTIONS` is non-empty:

1. Display each SUGGEST block to the user (one at a time) via `question` (OpenCode) / `AskUserQuestion` (Claude Code).
2. For each, accept `y` (approve) or `n` (decline). Approval triggers the action (e.g., setting `MODEL_CONFIG` override, or queuing a `/jlu-add-failure-pattern` call). Decline silently dismisses the suggestion.
3. Append a JSONL record to `<WORKSPACE>/.spec-workspace/.cache/suggestion-history.jsonl` for EACH decision (approved or declined). The record shape:

   ```json
   {"rule_id":"<id>","signature":"<sig>","action":"approved"|"declined","ts":"<iso8601>"}
   ```

   Both approved and declined actions start the 7-day cooldown, so the user is not re-prompted for the same finding immediately after responding.

If `SUGGESTIONS` is empty, continue silently — no findings means no friction.

Tracing is best-effort: if `bin/trace-suggest.mjs` errors out, the empty `SUGGESTIONS` variable means the workflow simply continues without prompts.

---

## Step 1 — Resolve Task

Read `.spec-workspace.json` once at the start of this step (if present) and cache it as `WORKSPACE_CONFIG`. Reuse this cached object in Step 2b instead of reading the file again.

1. If a `task-slug` is provided as a command argument:
   a. Use `WORKSPACE_CONFIG.workspace` to get the workspace path.
   b. Search `<WORKSPACE_PATH>/specs/` across all date folders for the matching slug.
2. If no `task-slug` provided:
   a. Find the most recent task (latest date folder, latest task within it).
   b. Auto-select it. Log to terminal: "Auto-selected task `<task-slug>`."

**Error gate**: If no task found, stop: "No task found. Run `/jlu-new-task` first."

**Store**: `TASK_DIR`, `TASK_SLUG`, `WORKSPACE_PATH`, `WORKSPACE_CONFIG`

---

## Step 2 — Load Task State

1. Read `<TASK_DIR>/TASKS.md`.
2. Extract:
   - Current status (draft, refining, planned, implementing, etc.)
   - Affected services list
   - Phase progress (if any phases have been executed)
   - Any blocked or failed phases
   - Setup mode from `## Branching → Mode` (default `worktree` if absent)

**Validation**:
- If status is `draft` or `refining`: stop. "Task is in `<status>` state. Run `/jlu-new-task <slug>` first to complete the spec interview and get it to `planned`."
- If status is `closed` or `cancelled`: stop. "Task is already `<status>`. Cannot execute."

**Store**: `CURRENT_STATUS`, `AFFECTED_SERVICES`, `PHASE_STATE`, `SETUP_MODE`

---

### 2b. Resolve Model Configuration

1. Reuse `WORKSPACE_CONFIG` loaded in Step 1 (do not re-read `.spec-workspace.json`).
2. If a `models` section exists in `WORKSPACE_CONFIG`, extract the model overrides.
3. Store as `MODEL_CONFIG` — a map of group name → model name.
4. When spawning agents in subsequent steps, resolve the model:
   - For proposal-agent: use `MODEL_CONFIG.proposal` or default `"sonnet"`
   - For test-writer, implementer, qa-agent, build-validator: use `MODEL_CONFIG.code` or default `"sonnet"`
   - For git-agent, tasks-agent: use `MODEL_CONFIG.operational` or default `"haiku"`
   - For summary-agent: use `MODEL_CONFIG.operational` or default `"sonnet"`

---

## Step 3 — Session Recovery (Decision #35)

If TASKS.md shows a mid-execution state (status is `implementing` and some phases are marked `done` while others are `pending` or `in_progress`):

1. Log the current state to terminal:
   ```
   Task `<TASK_SLUG>` — resuming interrupted execution.
   Completed: Phase 01, Phase 02
   Resuming from: Phase 03
   ```

2. If any phase has status `in_progress` (interrupted mid-execution):
   - Reset that phase's status to `pending`.
   - Log to terminal: "Phase <NN> was interrupted. Restarting from scratch."

3. Set `RESUME_FROM` = first phase that is not `done`. Skip to Step 7, starting from that phase.

---

## Step 3b — Mode Detection and Auto-Checkout (Decision gate)

Use `SETUP_MODE` parsed from Step 2 (do not re-read `TASKS.md`):

- If `SETUP_MODE = worktree` (or `## Branching` section absent): skip to Step 4. Implementation will run in the task worktree.
- If `SETUP_MODE = branch`: continue with the branch-mode pre-flight below.

### Branch-mode pre-flight (runs before the first phase)

**Skip this pre-flight entirely if Step 3 set `RESUME_FROM`.** On session resume, `production/<TASK_SLUG>` is already the active branch and its working tree legitimately contains the in-progress phase's edits — running the dirty-tree check here would produce a false abort.

For each affected service (first execution only):

1. Resolve the service's main repo root: `SERVICE_REPO_ROOT = <WORKSPACE_PATH> + services.yaml[service-id].path`. `cd <SERVICE_REPO_ROOT>` (the main repo, since there is no worktree).
2. Verify the working tree is clean:
   ```bash
   DIRTY=$(git status --porcelain)
   ```
   If `DIRTY` is non-empty, abort the workflow with:
   > Working tree of `<service-id>` is dirty, cannot auto-checkout `production/<TASK_SLUG>`. Resolve first and re-run `/jlu-execute-task`.
3. Verify `production/<TASK_SLUG>` exists locally:
   ```bash
   git rev-parse --verify production/<TASK_SLUG> >/dev/null 2>&1
   ```
   If missing, abort: *"Local branch `production/<TASK_SLUG>` is missing for `<service-id>`. Re-run `/jlu-new-task <TASK_SLUG>` to recreate, or create manually."*
4. Checkout:
   ```bash
   git checkout production/<TASK_SLUG>
   ```

**Store**: `MODE = "branch"` (for downstream agents that may need it).

Continue to Step 4.

---

## Step 4 — Generate Proposal (if needed)

If `<TASK_DIR>/PROPOSAL.md` does NOT exist:

### 4.0-pre — Validate authored stories (deterministic gate)

Before any proposal work, validate the decentralized story specs so a malformed story fails
here — not mid-execution. Run:

```
node <plugin-root>/bin/validate-stories.mjs <TASK_DIR>/stories \
  --services <WORKSPACE_PATH>/registry/services.yaml \
  --spec <TASK_DIR>/SPEC.md
```

- **`storiesPresent: false`** (legacy task, no `stories/` dir) → skip silently; the proposal-agent
  falls back to SPEC.md.
- **Exit 0** → stories are well-formed and every FR is covered; continue.
- **Exit 1** → print the stderr lines verbatim (they name the offending story + field, the
  uncovered FR, or the orphan story) and STOP. Do not generate a proposal from a broken story
  set — fix the stories (or re-run `/jlu-refine-task`) first. This is the same script the
  `new-task`/`refine-task` coherence gates run.

### 4.0 — Task Triviality Classification

Before invoking `jlu-proposal-agent`, classify the task to decide whether to synthesize PROPOSAL.md inline or run the full two-pass agent flow.

Set `TASK_IS_TRIVIAL = true` if **all** of the following hold:
- Single service in `AFFECTED_SERVICES`
- SPEC.md is ≤ 150 lines
- The task description (or SPEC.md `## Problem Statement`) matches one of the trivial patterns:
  - Rename / refactor (e.g., "rename X to Y")
  - Literal swap (e.g., "change `/brain/` to `/studio/`", "update copy")
  - Single-function fix or single-bug fix
  - Documentation-only update
  - Constant / config value change
- SPEC.md mentions none of: "endpoint", "event", "schema", "contract", "migration", "API", "publish", "subscribe" (heuristic for new public surfaces)

Otherwise: `TASK_IS_TRIVIAL = false`.

If `TASK_IS_TRIVIAL`:
1. Synthesize `<TASK_DIR>/PROPOSAL.md` inline using the proposal template at `<plugin-root>/jelou/templates/proposal.md`:
   - **Strategy**: copy the SPEC.md `## Problem Statement` verbatim
   - **Affected Services**: single row from `services.yaml`
   - **Phases**: a single phase named `01-<task-slug>` with the SPEC.md `## Requirements > Functional` list copied as the phase's immutable requirements
   - **Testing Strategy**: `Tier 1: cover each FR with a behavior test in the existing test convention. No deferred Tier 2.`
   - **Risks**: `None identified — trivial scope.`
2. Generate the single phase file at `<TASK_DIR>/services/<service-id>/phases/01-<phase-slug>.md` from `<plugin-root>/jelou/templates/phase.md`, populating Requirements from SPEC.md FR list.
3. Log: `Task classified as trivial — PROPOSAL.md and phase file synthesized inline.`
4. Skip Steps 4a-4f and continue to Step 6 (Transition to Implementing).

If `TASK_IS_TRIVIAL` is false: continue with Step 4a (full proposal-agent flow).

**Store**: `TASK_IS_TRIVIAL`

### 4a. Load Minimum Context (orchestrator)

Read in a single orchestrator message:

- `<TASK_DIR>/SPEC.md` (required — feeds the Step 4.0 triviality classifier and downstream gates)

Do NOT preload codebase files or `ENGINEERING_PRINCIPLES.md` into the orchestrator. The proposal-agent has `Read` access and pulls them itself. Preloading would balloon every subsequent agent dispatch in the task with 30–80k tokens of context the orchestrator does not need.

### 4b. Global Strategy Pass (Decision #21)

Spawn `jlu-proposal-agent` with model: **MODEL_CONFIG.proposal** (default: sonnet). In the prompt, include:

- **Inlined**: full SPEC.md content (already in orchestrator context from 4a), affected services list with their `services.yaml` entries (`{id, path, stack, docker?}`).
- **Paths to Read** (the agent reads on demand, the orchestrator does NOT prepend file content):
  - `<WORKSPACE_PATH>/principles/ENGINEERING_PRINCIPLES.md`
  - `<WORKSPACE_PATH>/registry/services.yaml`
  - For each affected service, the 6 codebase files at `<WORKSPACE_PATH>/services/<service-id>/codebase/{ARCHITECTURE,STACK,CONVENTIONS,INTEGRATIONS,STRUCTURE,CONCERNS}.md`. Missing files are tolerable — the agent skips silently.
- **Task**: "Produce the global proposal — cross-service strategy, dependency order, phase structure, contract boundaries, risks, testing strategy."

### 4c. Local Detail Pass (Multi-Service Only)

If there are **2+ affected services**, spawn one `jlu-proposal-agent` per service, model: **MODEL_CONFIG.proposal** (default: sonnet). Honor `PHASE_PARALLELISM` (Step 6.4): when `> 1`, fan out in a single orchestrator message; when `= 1` (default), dispatch sequentially. Each prompt includes:

- **Inlined**: full SPEC.md, the global strategy draft from 4b, the target service's `services.yaml` entry.
- **Paths to Read**: the 6 codebase files for the target service (same paths as 4b, scoped to one service).
- **Task**: "Expand service-specific execution details for `<service-id>`: local scope, relevant modules, implementation constraints, service-level phases."

Wait for all local agents to complete before continuing to 4d.

### 4d. Consolidate PROPOSAL.md

The orchestrator (or the global proposal agent in single-service mode) writes the consolidated `<TASK_DIR>/PROPOSAL.md`.

If a proposal.md template exists at `<plugin-root>/jelou/templates/proposal.md`, use it as the structure. The proposal MUST include:
- Implementation strategy overview
- Affected services with dependency order
- Phase breakdown (numbered, ordered by dependencies)
- Per-phase: requirements, scope, service(s), testing approach
- Risk assessment and mitigations
- Cross-service contracts (if multi-service)

### 4e. Generate Phase Files

For each phase defined in PROPOSAL.md, for each affected service:
1. Create `<TASK_DIR>/services/<service-id>/phases/<NN>-<phase-name>.md`
2. Use the phase.md template from `<plugin-root>/jelou/templates/phase.md` if available.
3. Each phase file has:
   ```markdown
   # Phase <NN>: <Phase Name>

   ## Requirements (immutable)
   <!-- Generated from PROPOSAL.md. Do not modify. -->
   - <requirement from proposal>
   - ...

   ## Execution (mutable)
   <!-- Updated by agents during implementation -->
   ### Status: pending
   ### Agent Output
   ### Artifacts
   ### Deviations
   ```

### 4f. Auto-Approve Proposal

Log the proposal summary to terminal (do not ask for approval):
```
## Proposal Generated — Auto-Approved

Phases: <N> phases across <N> services
Dependency order: <service-a> → <service-b> → ...

Full proposal: <TASK_DIR>/PROPOSAL.md
```

Continue to Step 6 (Transition to Implementing).

### 4g. If PROPOSAL.md Already Exists

Skip proposal generation. Read the existing PROPOSAL.md and phase files to resume execution.

---

## Step 6 — Transition to Implementing

1. Update `<TASK_DIR>/TASKS.md`:
   - Status: `implementing`
   - Add timestamp: `- Implementing: <current-datetime-ISO>`

2. **Per-service setup (once per task — not per phase).** Resolve the source path and capture the baseline commit so subsequent phases reuse cached values:

   a. Resolve `SERVICE_SOURCE_PATH[service-id]` via the worktree resolution algorithm in `references/worktree-resolution.md`. The algorithm is **mode-driven**, NOT a filesystem existence check:
      - `Mode: worktree` (`SETUP_MODE = worktree`): `SERVICE_SOURCE_PATH = <WORKSPACE_PATH>/<service-repo>/.worktrees/<TASK_SLUG>/`. If that path is missing, fall back to the main repo and log `Worktree missing for <service-id> despite Mode: worktree — using main repo.`
      - `Mode: branch` (`SETUP_MODE = branch`): `SERVICE_SOURCE_PATH = <WORKSPACE_PATH>/<service-repo>` (main repo root). **Ignore any `.worktrees/<TASK_SLUG>/` that may exist on disk** — it is leftover state from a prior attempt, not the task's working tree. If such a leftover is detected, log `Branch-mode task <TASK_SLUG> has a leftover worktree at <path>. Ignoring it for execution; clean up with /jlu-close-task or git worktree remove.`
      - `## Branching` section absent (legacy `spec/<slug>` tasks only): defer to `references/worktree-resolution.md` §3c.
   b. Record current HEAD as the pre-execution baseline: `cd <SERVICE_SOURCE_PATH[service-id]> && git rev-parse --short HEAD`. Per-service `git rev-parse` calls can run in parallel (single orchestrator message) when 2+ services.

   **Do NOT** run `docker compose up -d`, `docker compose ps`, or compute any container exec prefix here. The TDD pipeline runs entirely on the host — tests, build, lint, and format never go through a container. If the developer wants a dev container running for the service, that is `/jlu-start-dev`'s job and is independent of this workflow.

3. Update TASKS.md with the per-service baselines:
   ```markdown
   ## Commit Tracking
   - <service-id-1> pre-execution commit: <sha>
   - <service-id-2> pre-execution commit: <sha>
   ```

**Store** (per-service maps): `SERVICE_SOURCE_PATH`.

4. **Set local CPU safety throttles (once per task).**

   - `PHASE_PARALLELISM`: default `1` (sequential) unless explicitly overridden by `JLU_PHASE_PARALLELISM`. Clamp to `1..N` where `N = number of affected services`.

The orchestrator no longer runs the full test suite — Step 8b is reduced to an **affected-tests** regression check (lightweight). The full suite is now owned by the dedicated `/jlu-test-suite` skill, which the developer invokes on-demand before opening a PR. For background: `JLU_FINAL_TEST_PARALLELISM` and `JLU_TEST_MAX_WORKERS` are no longer read here; see `jelou/references/parallel-dispatch.md` for the deprecation note.

**Store** (task-level): `PHASE_PARALLELISM`.

---

## Step 7 — Execute Phases

Read the phases from PROPOSAL.md in dependency order. The orchestrator no longer iterates phases as a flat sequence — it builds a **wave plan** first (per-service lanes), then iterates wave-by-wave with cross-service parallelism inside each wave (H7).

### 7.0. Wave Planning (cross-phase parallelism gate)

Before the per-phase loop starts, decide whether this task runs sequentially (legacy) or in per-service waves.

#### Detect the strategy

1. Read PROPOSAL.md and look for a `## Execution Strategy` section. Recognized values:
   - `sequential` (or missing section) — current behavior. Phases run one at a time in PROPOSAL.md order. No parallelism beyond what 7d/7e already do for multi-service-per-phase fan-out.
   - `per-service-parallel` — opt-in. Phases are grouped by their owning service, and same-index phases from different services run concurrently (one orchestrator message with multiple `Agent` calls).
2. If `Execution Strategy` is missing, default to `sequential`. The proposal-agent SHOULD emit this section explicitly; treat its absence as a conservative default, not as opt-in.

**Why opt-in.** Per-service parallelism is safe only when services do not share cross-service contracts that gate one another. If service B's Phase 02 depends on service A's Phase 01 emitting an API, running them in the same wave would race. The proposal-agent is the right place to make that call — it has full visibility into the contracts. The orchestrator just honors the decision.

#### Build the wave plan

Delegated to `bin/plan-phase-waves.mjs` — deterministic and unit-tested, so the orchestrator never improvises the grouping logic.

```bash
node <plugin-root>/bin/plan-phase-waves.mjs \
  --task-dir="<TASK_DIR>" \
  --strategy="<STRATEGY>" \
  --phase-parallelism="<PHASE_PARALLELISM>"
```

**Output (single JSON object on stdout)**:

```json
{
  "strategy": "sequential" | "per-service-parallel",
  "phase_parallelism": <N>,
  "lanes": { "<service-id>": [{ "phase": "01", "phase_file": "<abs path>" }, ...] },
  "waves": [
    [{ "service": "<service-id>", "phase": "<NN>", "phase_file": "<abs path>" }, ...],
    ...
  ],
  "summary": "<one-line summary suitable for terminal>"
}
```

Parse the JSON once, store as `WAVE_PLAN`, and iterate `WAVE_PLAN.waves` for the rest of Step 7. The script handles:

- **Sequential**: one phase per wave, services alphabetical, phases lex within service.
- **Per-service-parallel**: zip per-service lanes by index, then chunk each wave by `PHASE_PARALLELISM` cap when a wave's phase count exceeds the cap.
- **Phase id parsing**: filenames like `03a-name.md` yield `phase=03a` so sub-phases (3a, 3b, 3c) stay in order.

#### Concurrency cap

Apply `PHASE_PARALLELISM` (from Step 6.4) as a cap on the number of phases dispatched simultaneously within a wave:

- If a wave has K phases and `PHASE_PARALLELISM = P` with `K > P`, split the wave into chunks of size P, processed serially.
- Default `PHASE_PARALLELISM = 1` keeps the wave plan but serializes each wave's phases — equivalent to sequential, just iterated differently. The developer (or a future autotune) can bump it via `JLU_PHASE_PARALLELISM`. The runtime clamp is `1..N` where `N = len(AFFECTED_SERVICES)`.

#### Per-wave execution

For each wave:

1. **Dispatch all phases in the wave concurrently** by emitting one orchestrator message that contains all the wave's Agent calls (test-writer, tdd-cycle, etc. — whichever each phase needs at this stage). See `jelou/references/parallel-dispatch.md` for the exact concurrency pattern, scope-isolation rules, and conflict-detection logic on return.
2. **Wait for every phase in the wave to reach `Status: done` (or `failed`/`skipped`) before starting the next wave.** This is the synchronization point. A phase that errors blocks only its lane — the wave does not move on until every phase in it reaches a terminal state.
3. **Within each phase**, steps 7a–7l below apply unchanged. Whether you run them sequentially per phase or in parallel across phases is governed by the wave-level dispatch only; the per-phase logic is identical.

#### When to abort the wave

If a phase in a wave hits the 5-retry pause (Escalation Format), the orchestrator pauses the entire workflow at that wave. The other phases in the wave that completed successfully are already committed; their state in TASKS.md is `done`. When the user resumes (via the question response), the failed phase re-enters its TDD cycle. Successful phases in the same wave are NOT re-run.

#### Logging

At the start of Step 7, log a one-line plan summary:

- `Sequential: <total-phases> phases, <N> services, PHASE_PARALLELISM=<P>.`
- `Per-service parallel: <total-phases> phases across <N> service lanes (max <MAX_LANE> phases), <MAX_LANE> waves, PHASE_PARALLELISM=<P>.`

Then, at the start of each wave:

- `Wave <i>/<total>: <K> phase(s) — <list of "<service>:<NN>" pairs>.`

### Step 7 — Agent dispatch wrapper (referenced by every subagent dispatch below)

Each subagent dispatch in this Step (test-writer, implementer, tdd-cycle, refactor-agent, qa-agent, build-validator) is wrapped in a span pair. Apply this pattern around every dispatch:

**Before the dispatch:**
```bash
DS_OUT=$(node "${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs" \
  --name agent_dispatch --scope task \
  --agent "<agent-role>" --model "$MODEL_FOR_AGENT" \
  --task "$TASK_SLUG" --service "$SERVICE_ID" --phase "$PHASE_NUM" \
  --parent "$PHASE_SPAN_ID" --trace "$WORKFLOW_TRACE_ID")
DISPATCH_SPAN_ID=$(echo "$DS_OUT" | jq -r '.span_id // ""')
```

Replace `<agent-role>` with the literal agent role (`test-writer`, `implementer`, `tdd-cycle`, `refactor-agent`, `qa-agent`, `build-validator`). `$MODEL_FOR_AGENT` is resolved from `MODEL_CONFIG` (Step 2b).

**After parsing the agent's JSON report:**

Extract from the report:
- `$AGENT_STATUS` — one of `ok`, `blocked`, `failed`, `escalated`
- `$AGENT_RETRIES` — internal retry count (from agent report, may be absent)
- `$AGENT_OUTCOME` — the `outcome` field (may be absent)
- `$DIFF_SIZE_LOC` — LOC added+removed from `git diff --shortstat` over reported artifacts (may be absent)
- `$ERROR_SIG` — `sha256(normalized_error_message)[:8]` when status is `blocked` or `failed`, else absent
- `$TOKENS_IN` / `$TOKENS_OUT` — dispatch token usage when the runtime exposes it in the report (`usage.input_tokens` / `usage.output_tokens`); best-effort, absent otherwise. When present, `cost_usd` is derived from the span's model tier automatically.

Then close the span:

```bash
node "${PLUGIN_ROOT:-.}/bin/trace-end-span.mjs" \
  --span "$DISPATCH_SPAN_ID" --status "$AGENT_STATUS" \
  ${AGENT_RETRIES:+--retries "$AGENT_RETRIES"} \
  ${AGENT_OUTCOME:+--outcome "$AGENT_OUTCOME"} \
  ${DIFF_SIZE_LOC:+--diff-size "$DIFF_SIZE_LOC"} \
  ${ERROR_SIG:+--error-sig "$ERROR_SIG"} \
  ${TOKENS_IN:+--tokens-in "$TOKENS_IN"} \
  ${TOKENS_OUT:+--tokens-out "$TOKENS_OUT"}
```

Empty `DISPATCH_SPAN_ID` (when `TRACE_DISABLED=1`) makes the close a no-op.

This wrapper applies to every `task` (OpenCode) / `Agent` (Claude Code) dispatch in the steps below. Do not skip the wrapper for any dispatch.

### 7a. Report Persistence Discipline (context-saturation guard)

For every sub-agent dispatched within this Step 7 loop (`jlu-test-writer`, `jlu-implementer`, `jlu-tdd-cycle`, `jlu-refactor-agent`, `jlu-qa-agent`, `jlu-build-validator`), the orchestrator MUST follow this protocol to keep its own context window bounded across an N-phase task:

1. **Receive the agent's full report** as the tool result. Parse the structured sections immediately.
2. **Persist the full report to disk** at `<TASK_DIR>/services/<service-id>/phases/<NN>-reports/<agent-name>-<round>.md`. Round suffix is `1` for the first dispatch in this phase, `2` for the first retry, etc. Create the parent directory on first write.
3. **Keep only a structured digest in the orchestrator's working memory** for downstream gating decisions:

   ```json
   {
     "agent": "jlu-implementer",
     "phase": "03a",
     "service": "api-gateway-service",
     "status": "GREEN",
     "test_command": "<command>",
     "files_modified_count": <N>,
     "files_modified": ["<path>", ...],
     "tests_written_count": <N>,
     "refactor_candidates_present": true | false,
     "deviations_present": true | false,
     "test_objections_present": true | false,
     "report_path": "<TASK_DIR>/services/.../<NN>-reports/jlu-implementer-1.md"
   }
   ```

   Capture only the fields that subsequent steps gate on (`PHASE_IS_TRIVIAL`, refactor skip, additive-only check). The full prose stays on disk for audit; the orchestrator does NOT keep it in context.

4. **When a downstream step needs the full report** (e.g., per-phase QA needs to see refactor candidate detail; final QA at 8c needs implementer file lists across all phases), re-read the report from disk on demand instead of relying on conversation history. This makes the cost N reads instead of N reports persistently held.

5. **Failure-context recycling**: when retrying a failed agent (up to 5 attempts), the orchestrator passes only the structured digest + the last 50 lines of the previous attempt's failure output, not the full prior report. The agent reads its own predecessor's full report from disk if it needs more context.

**Why this matters.** Each agent report is 500-2000 tokens. A 10-phase task with 4 agents per phase accumulates 20-80k tokens of report prose in orchestrator context — enough to push past the working window on Opus and force compaction mid-task. The persist-and-digest pattern caps the orchestrator's per-phase working-memory increment at ~200 tokens (structured digest) instead of ~5000 tokens (full report bundle).

### 7a.0 — Open phase span

Run:
```bash
PH_OUT=$(node "${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs" \
  --name phase --scope task \
  --task "$TASK_SLUG" --service "$SERVICE_ID" --phase "$PHASE_NUM" \
  --parent "$WORKFLOW_SPAN_ID" --trace "$WORKFLOW_TRACE_ID")
PHASE_SPAN_ID=$(echo "$PH_OUT" | jq -r '.span_id // ""')
```

Empty span_id (when `TRACE_DISABLED=1`) is tolerated.

### 7b. Update Phase Status

1. Update the phase file status to `in_progress`.
2. Update TASKS.md with phase start timestamp.
3. Output milestone to terminal: "Starting Phase <NN>: <Phase Name> for <service-id>"

### 7c. Resolve Service Source Path (cached lookup)

Per-service setup ran once at task start in Step 6.2. Look up the precomputed value for the current service:

- `SERVICE_SOURCE_PATH = SERVICE_SOURCE_PATH[service-id]`

Tests, build, lint, and format all run on the host runtime against this path — never via a container.

### 7c.1. Phase Mode Classification

Determine whether this phase runs in **docs** mode (no TDD — direct commit of documentation edits), **vertical** mode (one combined `jlu-tdd-cycle` agent doing RED→GREEN per FR), or **horizontal** mode (separate `jlu-test-writer` then `jlu-implementer`). The choice is delegated to `bin/classify-phase.sh mode` — the orchestrator no longer counts FR/NFR bullets inline or runs awk against frontmatter.

**Invocation**:

```bash
CLASSIFY_PHASE_FILE="<PHASE_FILE>" \
CLASSIFY_SERVICES_IN_PHASE="<K>" \
<plugin-root>/bin/classify-phase.sh mode
```

**Output (key=value)**:

- `mode=docs|vertical|horizontal`
- `fr_nfr_count=<N>`
- `frontmatter_override=docs|vertical|horizontal|trivial|none`
- `docs_validation=passed|failed|n/a`
- `docs_rejection_reason=<verb>` (only when override was `docs` and validation failed)
- `reason=size_gate|frontmatter_override|frontmatter_override_validated|docs_override_rejected|vertical_override_rejected_by_size_gate`

The script enforces:

- **Docs mode** requires explicit `**Mode: docs**` / `mode: docs` frontmatter AND zero code-change verbs (`implement`, `add endpoint`, `wire`, `inject`, `migrate`, `handler`, `controller`, `service`, `module`) in the requirements section. Heuristic-only docs detection is forbidden — the orchestrator cannot promote a phase to docs from inference.
- **Vertical mode** threshold: `fr_nfr_count ≤ 5` AND `services_in_phase == 1`. Above either: `horizontal`.
- **Mode: vertical** frontmatter override is rejected when the size gate disagrees (returns `horizontal` + `reason=vertical_override_rejected_by_size_gate`).
- **Mode: horizontal** frontmatter override is always honored (developers can opt into the dispute mechanism).

If `mode=docs`, skip the vertical/horizontal TDD path and jump to **Step 7df** (Docs Path).

Log to terminal:

- `Phase <NN> mode: docs (<N> doc requirements, <K> service(s)) — skipping TDD pipeline, going to commit-only path.`
- `Phase <NN> mode: vertical (<N> FR/NFR, 1 service) — dispatching jlu-tdd-cycle.`
- `Phase <NN> mode: horizontal (<N> FR/NFR, <K> services) — dispatching jlu-test-writer then jlu-implementer.`

**Store**: `PHASE_MODE`, `FR_NFR_COUNT`.

### 7df. Docs Path (docs mode only)

**Skip this step unless `PHASE_MODE == docs`.** For docs phases, the orchestrator does NOT dispatch test-writer, implementer, refactor, per-phase QA, or build-validator. The developer (or the parent orchestrator in nested-execution mode) is expected to have already made the documentation edits on the task branch before invoking execution; the orchestrator's job here is to scope-check and commit them.

1. Capture the current diff on the task branch:
   ```bash
   cd <SERVICE_SOURCE_PATH>
   git diff --name-only HEAD
   ```
2. **Scope check** (mirrors Step 7j's intent but enforces docs-only): every file in the diff MUST match a documentation extension or path: `.md`, `.mdx`, `.txt`, `.rst`, `README*`, `CHANGELOG*`, files under `docs/`, `verification.md`. If any non-doc file appears, abort with:

   > "Phase <NN> declared `mode: docs` but the diff contains code changes: `<file-list>`. Either remove the non-doc edits or change the phase's mode to vertical/horizontal."

3. If the diff is empty, abort: `Phase <NN> declared mode: docs but the working tree contains no documentation changes. Make the edits or remove the phase.`
4. Stage and commit using Step 7j's commit procedure but with `<type> = docs`. The commit message body still references `Phase <NN> of production/<TASK_SLUG>`.
5. Skip refactor (7g), per-phase QA (7h), and build-validator (7k) for docs phases — they have nothing to evaluate. Jump straight to Step 7l (Complete Phase) after the commit lands.

Log: `Phase <NN> docs path complete — <N> doc files committed.`

### 7d. TDD Red — Spawn Test Writer (horizontal mode only)

**If `PHASE_MODE == vertical`, skip 7d AND 7e entirely — both are replaced by 7de. If `PHASE_MODE == docs`, skip all of 7d-7k — the docs path at 7df handles the phase.**



When the phase affects multiple services with no cross-service contract being defined this phase, dispatch one `jlu-test-writer` per service **in a single orchestrator message** only when `PHASE_PARALLELISM > 1`. Otherwise run sequentially. See `jelou/references/parallel-dispatch.md` for the pattern, scope-isolation rules, and conflict-detection on return.

Spawn `jlu-test-writer` agent with model: **MODEL_CONFIG.code** (default: sonnet):
- **Input**:
  - Phase requirements (from the phase file's immutable section)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Service source path (worktree or repo)
  - SPEC.md relevant sections
  - `TEST_TIER: 1` (TDD cycle — fast, isolated tests only)
- **Task**: Write failing tests that cover the phase requirements.
- **Output**: Test file paths and a summary of what was tested.

**Red verification (trust-the-report)**: the test-writer already ran tests in its own session and reports `Status` + `Command`. Don't re-run in the orchestrator unless the report is incomplete or flags an unexpected pass.

1. Parse the test-writer's report.
2. If the report includes `Status: RED` AND a `Command:` line with the exact test runner invocation: trust the result. Continue to Step 7e.
3. If the report is missing either field, or the report explicitly notes any unexpected pass: re-run the new test files locally (`<command>` on the host) and validate.
4. If a test passes unexpectedly (either flagged in the report or surfaced by the local re-run):
   - Log to terminal: "Test `<test-name>` passes without implementation — auto-investigating."
   - Spawn a fresh `jlu-test-writer` with model: **MODEL_CONFIG.code** (default: sonnet) to evaluate whether the test is correct or the requirement is already implemented.
   - If already implemented: mark requirement as covered, skip to next.
   - If test is incorrect: rewrite and re-verify Red state.

### 7e. TDD Green — Spawn Implementer (horizontal mode only)

**If `PHASE_MODE == vertical`, skip this step — it is replaced by 7de.**

When the phase affects multiple services with no shared file edits, dispatch one `jlu-implementer` per service **in a single orchestrator message** only when `PHASE_PARALLELISM > 1`. Otherwise run sequentially. See `jelou/references/parallel-dispatch.md`. After all implementers return, compare `artifacts` arrays to detect any unintended overlap before running per-phase QA.

Spawn `jlu-implementer` agent with model: **MODEL_CONFIG.code** (default: sonnet):
- **Input**:
  - Phase requirements
  - Test file paths (from the test writer)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Service source path
- **Task**: Implement the minimum code to make all tests pass.
- **Output**: Implementation file paths and a summary.

**Post-Green lint/format** (delegated to `bin/format-changed-files.sh`):

The orchestrator no longer decides which format command to run — that detection chain (CONVENTIONS.md → package.json scripts → JS/TS default → skip) lives in the script. One Bash invocation, deterministic.

1. Build `CHANGED_FILES` from the union of the implementer's `Files Modified` and the test-writer's `Tests Written` (newline-separated). If empty, the script will return `status=skip reason=no_files` — no harm in still calling it, but you can also short-circuit.
2. Invoke:
   ```bash
   FORMAT_SOURCE_PATH="<SERVICE_SOURCE_PATH>" \
   FORMAT_CHANGED_FILES="$(printf '%s\n' <file-1> <file-2> ...)" \
   FORMAT_CONVENTIONS="<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md" \
   <plugin-root>/bin/format-changed-files.sh
   ```
3. Parse the key=value output:
   - `status=ok` + `command=<cmd>` + `files_count=<N>` — format ran. Continue to Green verification, but treat this as "files may have been modified" — re-run the phase test files to confirm Green is maintained.
   - `status=skip` + `reason=no_files|no_command_detected` — nothing to do; continue without re-running tests.
   - `status=failed` + `reason=format_failed` — the format command itself errored. Log the stderr, do NOT retry; surface the failure and continue to Green verification (the failure is informational for the developer, not a phase blocker on its own).

**Green verification (trust-the-report)**: the implementer already ran phase tests in its own session and reports `Status` + `Command`. Don't re-run in the orchestrator unless the report is incomplete or post-Green lint/format modified files without re-verification.

1. Parse the implementer's report.
2. If the report includes `Status: GREEN` AND a `Command:` line with the exact test runner invocation: trust the result. Continue to Step 7e.1.
3. If the report is missing either field, OR the post-Green lint/format step modified files (and the implementer didn't re-verify), OR `PHASE_IS_TRIVIAL` cannot yet be classified due to missing diff data: re-run the phase test files locally (`<command>` on the host) and confirm Green.
4. If verification fails (either the trusted report turns out wrong on a sanity spot-check, or the orchestrator's re-run fails):
   - Log failures to terminal.
   - Spawn a fresh `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) and accumulated failure context (Decision #1).
   - Retry up to 5 times total.
   - If still failing after 5 attempts: pause and notify user (see Escalation Format below).

### 7de. TDD Vertical Cycle — Spawn TDD Cycle Agent (vertical mode only)

**Skip this step if `PHASE_MODE == horizontal` — RED→GREEN is handled by 7d and 7e in that mode.**

When `PHASE_MODE == vertical`, dispatch a single `jlu-tdd-cycle` agent with model: **MODEL_CONFIG.code** (default: sonnet). The agent runs RED→GREEN per FR within one session — see `tdd-principles.md` §3 and `tdd-cycle.md` "Agent Separation".

- **Input**:
  - Phase requirements (from the phase file's immutable section)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/STACK.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/STRUCTURE.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/ARCHITECTURE.md`
  - Service source path (worktree or repo)
  - SPEC.md relevant sections
  - `TEST_TIER: 1` (TDD cycle — fast, isolated tests only; Tier 2 deferred to Step 8a)
- **Task**: For each requirement in the phase, write one failing test (RED), implement the minimum code to make it pass (GREEN), then move to the next requirement. Self-correct without silently rewriting tests — any rewrites must be documented under `Test Rewrites` with a spec quote.
- **Output**: A `TDD Cycle Report — Phase <N>` covering all slices, with `Files Modified`, `Tests Written`, `Refactor Candidates`, `Test Rewrites`, and a final `Command:` line.

**Verification (trust-the-report)**: the agent already ran every slice's tests in its own session and reports `Final Test Run` status and command. Don't re-run in the orchestrator unless the report is incomplete.

1. Parse the report.
2. If the report includes `Status: GREEN` AND a `Command:` line AND a slice table where every row is `GREEN`: trust the result. Continue.
3. If any of those is missing, OR the report flags `status: blocked`: re-run the test files listed in `Tests Written` locally (`<command>` on the host) and validate. If the local re-run shows red tests that the agent reported green, treat this as a phase failure and follow the standard retry path (spawn a fresh `jlu-tdd-cycle` with accumulated failure context, retry up to 5 times; pause and notify user after the 5th attempt).

**Post-Green lint/format**: invoke `bin/format-changed-files.sh` exactly as in Step 7e. `CHANGED_FILES` here is the union of the `jlu-tdd-cycle` agent's `Files Modified` + `Tests Written`. Same output handling (`status=ok` re-runs phase tests, `status=skip` continues, `status=failed` surfaces).

### 7e.1 — Phase Triviality Classification

After Green is verified, classify the phase to gate downstream agents (refactor, per-phase QA, build-validator). Delegated to `bin/classify-phase.sh trivial` — the orchestrator no longer runs `git diff --shortstat` + grep loops inline.

**Invocation**:

```bash
CLASSIFY_SOURCE_PATH="<SERVICE_SOURCE_PATH>" \
CLASSIFY_SERVICES_IN_PHASE="<K>" \
CLASSIFY_FRONTMATTER_TRIVIAL="<0|1>" \
<plugin-root>/bin/classify-phase.sh trivial
```

Set `CLASSIFY_FRONTMATTER_TRIVIAL=1` when the Step 7c.1 result returned `frontmatter_override=trivial`. Otherwise pass `0`.

**Output (key=value)**:

- `trivial=true|false`
- `lines_changed=<N>`, `files_changed=<N>`
- `has_lockfile`, `has_migration`, `has_dts`, `has_tsconfig`
- `reason=size_gate|frontmatter_override|frontmatter_override_downgraded`
- `downgrade_reason=<list>` (only when frontmatter override was downgraded)

The script enforces:

- **Default classifier**: `trivial=true` only when `lines ≤ 20 AND files ≤ 3 AND no lockfile/migration/d.ts/tsconfig AND services_in_phase == 1`.
- **Frontmatter override** (`mode: trivial`): accepted unless safety bounds exceeded (`lines > 50` OR any of lockfile/migration/d.ts). On exceedance, the script returns `trivial=false` + `reason=frontmatter_override_downgraded` so the orchestrator falls back to the full pipeline.

Log to terminal:

- If trivial: `Phase <NN> classified as trivial — skipping refactor (7g), per-phase QA (7h), and build-validator (7k).`
- If not trivial: `Phase <NN> non-trivial — running full per-phase pipeline.`
- If a frontmatter override was downgraded: `Phase <NN> trivial override rejected — <downgrade_reason>.`

**Store**: `PHASE_IS_TRIVIAL` (from `trivial` field).

### 7f. Test Dispute Resolution (Decision #5) — horizontal mode only

**Skip if `PHASE_MODE == vertical`.** Vertical mode has no separate dispute mechanism because the `jlu-tdd-cycle` agent owns both test and implementation. Test rewrites in vertical mode are surfaced under the agent's `Test Rewrites` section (each with a spec quote) and verified at per-phase QA (7h) and final QA (8c). If `Test Rewrites` is non-empty, log a one-line warning and pass the rewrites list through to per-phase QA for scrutiny.

If the implementer flags that a test is incorrect:
1. Spawn a **fresh** `jlu-test-writer` agent with model: **MODEL_CONFIG.code** (default: sonnet) and:
   - The original phase requirements from SPEC.md and the phase file
   - The implementer's objection (what it believes is wrong with the test)
   - The test code in question
2. The new test agent evaluates independently:
   - If it agrees the test is wrong: it rewrites the test.
   - If it confirms the test is correct: it responds with justification.
3. If the test was rewritten:
   - Re-run TDD Green (spawn implementer again with updated tests).

### 7g. Refactor Pass

**Skip if `PHASE_IS_TRIVIAL`.** Trivial phases (≤ 20 LOC, ≤ 3 files, no lockfile/migration/exported-symbol changes) don't earn the refactor pass overhead.

**Skip if the implementer (horizontal) or tdd-cycle (vertical) report's `Refactor Candidates` section is empty or contains only `None`.** No candidates means there is nothing for the refactor agent to act on — dispatching it would burn a sub-agent dispatch to return `NO_CHANGES`. Log `Phase <NN> refactor skipped — implementer reported no candidates.` and continue to 7h.

Otherwise, spawn `jlu-refactor-agent` with model: **MODEL_CONFIG.code** (default: sonnet). The agent applies surgical refactors guided by `jelou/references/tdd-principles.md` §7, keeping tests green at every step.

- **Input**:
  - Phase context (phase number, service-id)
  - Service source path (worktree or repo)
  - The implementer's full report (especially `Files Modified` and `Refactor Candidates`)
  - The exact test command the implementer reported (so the agent runs the same suite)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/ARCHITECTURE.md`
- **Task**: Apply refactor candidates one at a time. Re-run the phase test files after each. Roll back any refactor that goes red. Stay within `Files Modified`. Never touch test files. Never change a public API.
- **Output**: A `Refactor Agent Report — Phase <N>` with `Status: APPLIED | NO_CHANGES | BLOCKED`.

**Handling the report:**

- `APPLIED`: continue to 7h.
- `NO_CHANGES`: continue to 7h.
- `BLOCKED` (two consecutive refactors went red on first try): log the agent's last error output and continue to 7h with a note in the per-phase QA prompt — do not retry the refactor agent. The remaining candidates are not load-bearing.

No re-run of the phase tests is needed at the orchestrator level — the refactor agent re-runs after every step and reports the final state. Trust the report unless `Status` or the green confirmation is missing, in which case re-run the phase test files locally.

### 7h. Per-Phase QA (Decision #13)

**Skip if `PHASE_IS_TRIVIAL`.** Comprehensive QA still runs at Step 8c against the full task scope.

**Skip if the phase is purely additive AND the implementer reported no issues.** A phase is purely additive when:

1. `bin/classify-phase.sh additive` returns `additive=true`. Invocation:
   ```bash
   CLASSIFY_SOURCE_PATH="<SERVICE_SOURCE_PATH>" \
   <plugin-root>/bin/classify-phase.sh additive
   ```
   The script computes `git diff --diff-filter=M` and `--diff-filter=D` and returns `additive=true` only when both are empty. Output also includes `modified_count` and `deleted_count` for logging.
2. The implementer's report (horizontal) or tdd-cycle report (vertical) lists no `Test Objections` AND no `Deviations from Expected Approach`. Both fields must be either absent or contain only the literal "None".
3. The refactor agent — if it ran — returned `Status: NO_CHANGES` (or 7g was skipped because there were no candidates).

The reasoning: per-phase QA's primary value is catching convention drift and pattern violations in *modified* code. For purely additive code that ran clean through implementer + refactor, the static review is duplicate effort with the final QA at Step 8c (which sees the same files). The risk of deferral is bounded — Step 8c catches any issues before the task transitions to `ready_to_publish`.

Log `Phase <NN> per-phase QA skipped — purely additive, implementer clean, deferred to final QA (8c).` and pass the phase's `Files Modified` list through to a `DEFERRED_QA_PHASES` accumulator that Step 8c reads.

Otherwise, spawn `jlu-qa-agent` with model: **MODEL_CONFIG.code** (default: sonnet) for a static per-phase review:
- Phase file with requirements
- List of files created/modified in this phase
- `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/STRUCTURE.md`
- The `PHASE_MODE` (vertical or horizontal) so QA can apply mode-specific scrutiny
- If `PHASE_MODE == vertical` AND the `jlu-tdd-cycle` report had a non-empty `Test Rewrites` section: pass the rewrites list and ask QA to verify each rewrite has a valid spec quote and that the rewritten tests still describe behavior, not implementation.

The QA agent performs static analysis ONLY — it reads code and checks conventions. It does NOT run tests. Test execution is reserved for Step 8.

If QA finds code quality issues (convention violations, function length, test tier violations):
- Log issues to terminal.
- Attempt to fix automatically: spawn `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) and QA findings.
- After fix, re-run ONLY the phase test files to confirm Green is maintained.
- Retry up to 5 times total.
- If still failing after 5 attempts: pause and notify user (see Escalation Format below).

### 7i. Update TASKS.md (inline)

The orchestrator edits TASKS.md directly via `Edit` — no agent dispatch needed for string substitution.

1. Locate the phase entry in `<TASK_DIR>/TASKS.md`.
2. Update via `Edit`:
   - Status: `pending` → `done`
   - Add: test pass/fail counts (from the Green verification step), artifacts list (file paths from test-writer + implementer reports), and any deviations noted by the implementer.
3. The commit SHA is appended in Step 7l after the inline commit in Step 7j; do not record it here.

### 7j. Git Commit (batched via finalize-phase.sh)

The orchestrator delegates pre-flight, scope check, stage, commit, and rev-parse to `<plugin-root>/bin/finalize-phase.sh` — one Bash dispatch per phase instead of five. The script is deterministic shell; no agent dispatch.

**Invocation**:

```bash
FINALIZE_SOURCE_PATH="<SERVICE_SOURCE_PATH>" \
FINALIZE_TASK_SLUG="<TASK_SLUG>" \
FINALIZE_PHASE_NN="<NN>" \
FINALIZE_PHASE_TITLE="<phase title>" \
FINALIZE_SERVICE_ID="<service-id>" \
FINALIZE_COMMIT_TYPE="<type>" \
FINALIZE_EXPECTED="$(printf '%s\n' <declared-file-1> <declared-file-2> ...)" \
<plugin-root>/bin/finalize-phase.sh
```

**Inputs**:
- `FINALIZE_EXPECTED` is the union of declared artifacts from the test-writer's `Tests Written` and the implementer's `Files Modified` (horizontal mode) or the tdd-cycle agent's combined `Files Modified` + `Tests Written` (vertical mode). For docs mode, use the diff's actual content. The script appends known auto-staged manifests internally (`package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `composer.lock`, `poetry.lock`, `Cargo.lock`, `go.sum`); do not include them in `FINALIZE_EXPECTED`.
- `<type>` selection: `feat` for new functionality, `fix` for bug fixes, `test` for test-only phases, `refactor` for refactoring without behavior change, `docs` for documentation-only.

**Output parsing**:

The script writes `key=value` lines to stdout. Parse them:

- `status=ok` + `commit_sha=<sha>` + `files_committed=<N>` → phase commit succeeded. Carry `commit_sha` into Step 7l.
- `status=abort` + `reason=wrong_branch | source_path_missing | not_a_git_repo | no_changes | unexpected_files_in_diff | commit_failed | invalid_commit_type` → handle per the table below.

| Abort reason | Orchestrator action |
|--------------|---------------------|
| `wrong_branch` | Abort the whole workflow. The branch invariant is load-bearing; surface to user. |
| `source_path_missing` / `not_a_git_repo` | Abort. Source path resolution is broken; surface to user. |
| `no_changes` | Treat as a phase no-op. Log `Phase <NN> produced no diff — skipping commit and continuing.` Do not retry. |
| `unexpected_files_in_diff` | Parse `unexpected_files=<csv>`. Treat as a phase failure. Surface to user with the file list (same message as the old inline scope check). Do not auto-stage. |
| `commit_failed` | A pre-commit hook (lint, commitlint, etc.) rejected the commit. Parse the script's stderr (last 50 lines), dispatch a `jlu-implementer` with the hook output as failure context, then retry Step 7j (up to 5 attempts). Never bypass with `--no-verify`. |
| `invalid_commit_type` | Orchestrator bug — the `<type>` derivation logic produced something outside `feat|fix|docs|refactor|test`. Abort and surface to user. |

**Forbidden operations** (orchestrator must NEVER invoke, even via Bash, regardless of finalize-phase.sh):
- `git push --force` / `git push -f`
- `git reset --hard`
- `git rebase` (any flavor)
- `git checkout main`, `git checkout master`, `git checkout alpha`
- `git branch -D`
- `git commit --no-verify`

### 7k. Build Validation

**Skip if `PHASE_IS_TRIVIAL`.** Tier 2 build/regression check still runs at Step 8b.

**Skip if no compilable source files changed.** Build `CHANGED_FILES` the same way as Step 7e (union of test-writer and implementer artifacts; in vertical mode, the tdd-cycle agent's `Files Modified` + `Tests Written`). Delegate the check to `bin/classify-phase.sh compilable`:

```bash
CLASSIFY_FILES="$(printf '%s\n' <file-1> <file-2> ...)" \
<plugin-root>/bin/classify-phase.sh compilable
```

**Output (key=value)**:

- `compilable=true|false`
- `forcing_file=<path>` (only when a forcing file like `package.json` or `tsconfig*.json` flips the result to true)
- `extensions=<csv>` (unique non-compilable extensions seen)

The script's allowlist of non-compilable extensions: `.md`, `.mdx`, `.txt`, `.rst`, `.yaml`, `.yml`, `.toml`, `.ini`, `.env`, `.env.*`, `.example`, `.css`, `.scss`, `.sass`, `.less`, `.html`, `.htm`, `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico`, `.pdf`, and plain `.json` (except `package.json` / `tsconfig*.json` which always force a build).

If `compilable=false`: log `Phase <NN> build skipped — no compilable source files changed (only <extensions>).` and continue to 7l.

Otherwise, spawn `jlu-build-validator` agent with model: **MODEL_CONFIG.code** (default: sonnet):
- **Input**:
  - Service source path (worktree or repo)
  - `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
  - Phase context (phase number, service-id)
- **Task**: Run the project build command on the host and fix any compilation failures. Do NOT run the test suite.

**If the agent reports PASS** (with or without fixes):
- If fixes were applied: re-run ONLY the phase test files to confirm Green is maintained. Then commit the build fixes inline using the same procedure as Step 7j (with message `fix(<service-id>): resolve build errors from phase <NN>`).
- If no fixes needed: continue to 7l.

**If the agent reports SKIP** (no build command detected):
- Continue to 7l. No action needed.

**If the agent reports FAIL** (5 rounds exhausted):
- Pause and notify user (see Escalation Format below).

### 7l. Complete Phase

1. Update phase file status to `done`.
2. Output milestone to terminal: "Phase <NN> complete. Tests: <pass-count>/<total-count> passing."
3. Record the phase's commit SHA in TASKS.md. The SHA was already returned by `finalize-phase.sh` in Step 7j (`commit_sha=<sha>` line); reuse it — do NOT run `git rev-parse` again, that's a duplicate Bash dispatch for data you already have.

   If Step 7j returned `status=abort` with `reason=no_changes` for this phase, write `Commit: (no diff)` instead of an SHA.

   Update the phase entry in TASKS.md:
   ```markdown
   ### Phase <NN>: <Phase Name>
   - Status: done
   - Commit: <sha>
   - Completed: <ISO datetime>
   ```
4. **No container cleanup.** The TDD pipeline never starts or manages containers, so there's nothing to prune.

### 7z — Close phase span

Determine `$PHASE_OUTCOME`:
- `ok` — phase reached green tests + commit
- `blocked` — three-strike rule fired
- `failed` — phase aborted (non-recoverable)

Determine `$PHASE_SUCCESS` — the correctness signal from the RED test oracle, independent of `$PHASE_OUTCOME` (`ok` means "did not crash", not "was correct first try"):
- `pass@1` — tests went green on the implementer's first attempt (`$AGENT_RETRIES == 0`)
- `pass@k` — green only after retries (`$AGENT_RETRIES > 0`)
- `fail` — the phase never reached green (`blocked`/`failed`)

Set `$PHASE_ATTEMPTS` to the implementer's attempt count (`$AGENT_RETRIES + 1`). Both are absent for `docs`-mode phases with no test oracle.

Run:
```bash
node "${PLUGIN_ROOT:-.}/bin/trace-end-span.mjs" \
  --span "$PHASE_SPAN_ID" --status "$PHASE_OUTCOME" \
  ${PHASE_SUCCESS:+--success "$PHASE_SUCCESS"} \
  ${PHASE_ATTEMPTS:+--attempts "$PHASE_ATTEMPTS"}
```

---

## Step 8 — Final Validation

After all phases are complete, this is the **regression check** for the entire task. It does NOT run the full test suite — Step 8b runs only the tests affected by the task's diff. The full suite is owned by the on-demand `/jlu-test-suite` skill (invoke before `/jlu-ship` when you want a richer signal) and by CI on push.

### 8a. Write Tier 2 Integration Tests (gated)

**Aggregate first**: collect every `Tier 2 Deferred` entry reported across phases. If empty, skip to Step 8b and log: `Tier 2 step skipped — no deferred requirements.`

Otherwise, for each service that has Tier 2 deferred requirements:
1. Collect all deferred requirements from that service's phase files.
2. Spawn `jlu-test-writer` with model: **MODEL_CONFIG.code** (default: sonnet):
   - **Input**: Deferred requirements list, CONVENTIONS.md, service source path
   - **TEST_TIER: 2** (integration tests against host-resident infrastructure only — no containers, no Testcontainers)
   - **Task**: Write integration tests for all deferred requirements. Assume any required real dependency (database, queue, peer service) is already running on the host; if it isn't, mark the test skipped with a clear reason rather than starting anything yourself.
3. Spawn `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) if the integration tests reveal missing wiring (e.g., a repository method needs a real database query that was mocked in Tier 1).

### 8b. Affected-Tests Regression Check

After all phases are complete, run only the tests **related to the modified files**. This is the cheap regression net for cross-cutting changes (helpers, types, base classes) without saturating local CPU/RAM. The full suite is the developer's job to run via `/jlu-test-suite` (or CI's, on push).

The orchestrator never invokes the bare full-suite command (e.g., `npm test`) here. That responsibility was extracted from this workflow.

#### 8b.1 — Compute the affected file set

For each affected service:

```bash
cd <SERVICE_SOURCE_PATH[service-id]>
PRE_SHA=<the pre-execution commit cached in TASKS.md "Commit Tracking" for this service>
git diff --name-only "$PRE_SHA"..HEAD > .changed-files.txt
```

Filter `.changed-files.txt` to source files only — drop:
- `*.md`, `*.lock`, `*.yaml`, `*.yml`, `*.json` (except `package.json`)
- Any `*.test.*`, `*.spec.*`, `__tests__/*`, `test/**`, `tests/**`
- Lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`)
- Migration files (`migrations/*`)
- Files under `dist/`, `build/`, `coverage/`, `.next/`

Call the result `CHANGED_SOURCES`.

**If `CHANGED_SOURCES` is empty**, skip Step 8b entirely. Log: `No production source changed for <service-id> — affected-tests step skipped.` Continue to Step 8c.

**If config files were the only thing that changed** (e.g., only `tsconfig.json`, `package.json`, or migration files): skip Step 8b but log: `Only config/migration files changed for <service-id> — affected-tests cannot detect related tests. Run /jlu-test-suite before opening PR.`

#### 8b.2 — Detect runner

Same detection chain as `/jlu-test-suite` Step 4 (read CONVENTIONS.md, fall back to manifest introspection). Identify `RUNNER` ∈ `{jest, vitest, mocha, pytest, go, unknown}`.

#### 8b.3 — Build the affected-tests command

| RUNNER | Command | Notes |
|--------|---------|-------|
| jest | `npx jest --findRelatedTests $CHANGED_SOURCES --maxWorkers=2` | Jest's native related-tests resolver |
| vitest | `npx vitest related $CHANGED_SOURCES --pool=threads --poolOptions.threads.maxThreads=2 --run` | Vitest's `related` mode |
| pytest with `pytest-picked` installed | `pytest --picked --mode=branch -n 2` (drops `-n` if no xdist) | Picks tests based on git diff |
| pytest with `pytest-testmon` installed | `pytest --testmon -n 2` | Persistent affected-test map |
| pytest without either plugin | (skip) | Log: `pytest affected-test detection unavailable. Run /jlu-test-suite before opening PR.` |
| mocha | (skip) | Log: `Mocha has no built-in affected-tests resolver. Run /jlu-test-suite before opening PR.` |
| go | `go test -p 2 $(go list -deps ./... \| grep -Ff <(awk -F/ '{print $1"/"$2}' .changed-files.txt \| sort -u))` | Lists packages depending on changed packages. If shell magic above is risky, fall back to `go test ./...` with `-p 2` |
| unknown | (skip) | Log: `Affected-tests unavailable for unknown runner. Run /jlu-test-suite before opening PR.` |

The cap is **fixed at 2 workers** here (not a configurable env var). Affected sets are usually small (10–50 tests); two workers is enough to be fast and never overloads the box. If you want more parallelism, that's the dev's call — they run `/jlu-test-suite` (which still uses 1 worker but covers the full suite) or invoke the runner directly.

Never inject `--coverage` or `--cov` here. Coverage belongs in CI.

#### 8b.4 — Dispatch

1. Use `PHASE_PARALLELISM` from Step 6.4 to decide cross-service fan-out. Default `1` (sequential per service).
2. Per service, run the constructed command on the host runtime. Stream stdout for dev visibility.
3. Capture the runner's exit code as `AFFECTED_TESTS_RESULT[service-id]`.

#### 8b.5 — Handle failures

If any service's affected tests failed:
- Aggregate failing test names + file paths.
- Spawn `jlu-implementer` with model: **MODEL_CONFIG.code** (default: sonnet) and the failure context to fix. Retry up to 5 times.
- If still failing after 5 attempts: pause and notify user.

If a service was skipped (mocha, plugin-less pytest, unknown runner), pass `AFFECTED_TESTS_RESULT[service-id] = SKIPPED` to Step 8c.

#### 8b.6 — Pass results to Step 8c

The QA agent expects a structured object:

```
AFFECTED_TESTS_RESULT = {
  "<service-id>": {
    "status": "PASS | FAIL | SKIPPED | NO_DIFF",
    "command": "<exact command run>",
    "tests_run": <N>,
    "tests_failed": <N>,
    "failing_tests": ["<name @ file:line>", ...],
    "skip_reason": "<only if SKIPPED>"
  },
  ...
}
```

### 8c. Comprehensive QA (static only)

Spawn `jlu-qa-agent` with model: **MODEL_CONFIG.code** (default: sonnet) for a **static** comprehensive review. The QA agent **must NOT run the test suite** — not the affected-tests subset, not coverage, not anything. Test execution this task is owned by Step 8b (affected) and by `/jlu-test-suite` (on-demand full); the QA agent's job is static analysis.

Pass the QA agent the captured Step 8b results (affected-tests verdict per service):

- **Step 8b affected-tests results** (`AFFECTED_TESTS_RESULT` from 8b.6): PASS/FAIL/SKIPPED/NO_DIFF per service, exact command run, failing tests if any
- **Deferred per-phase QA review** (`DEFERRED_QA_PHASES` from Step 7h): the list of phases that skipped per-phase QA because they were purely additive with a clean implementer report. For each deferred phase, the entry includes `{phase_id, service_id, files_modified}`. The QA agent must explicitly include these phases' `files_modified` in its convention/code-smell/over-engineering scan and flag any issue it would have flagged in per-phase QA. If `DEFERRED_QA_PHASES` is empty, treat this as the normal final-validation case.
- **Full coverage analysis**: Are all requirements from SPEC.md covered by tests? (read SPEC.md and test files; do not run them). Note: this is static — checking that every requirement has at least one test file asserting the behavior, not measuring runtime coverage percentages
- **Pre-PR recommendation**: if any service's 8b result was SKIPPED (mocha, plugin-less pytest, or only config files changed), the QA agent surfaces a clear note in its report:
  > `Pre-PR action: run /jlu-test-suite from <service-path> before opening the pull request to confirm no regressions in the full suite.`
- **Edge case & coverage-breadth review**: Were edge cases from the spec addressed? AND — this is the fallback for phases where per-phase QA (7h) was skipped (trivial / additive / docs) — pass the QA agent the union of new/modified DTO/validator files across ALL phases (from each phase's `Files Modified`, including `DEFERRED_QA_PHASES` and trivial phases) and restate the Coverage-Breadth FAIL rule verbatim: a new/modified validated DTO field (request body or typed query parameter) with no test that sends a violating payload and asserts the 4xx is a FAIL, and a collection/reference field exercised only empty is a FAIL. The breadth gate must fire at 8c whenever 7h was skipped.
- **Cross-service contract verification** (if multi-service): Do the services communicate correctly? Are contracts honored?
- **Convention compliance**: Final check against CONVENTIONS.md
- **Code smell detection**: Full structural review
- **Over-engineering detection**: Verify minimum viable implementation

Log the validation results to terminal:
```
## Final Validation Results

### Coverage
- Requirements covered: <N>/<total>
- Test suites passing: <N>/<total>
- Tier 1 (unit/mock) tests: <count>
- Tier 2 (integration) tests: <count>

### Issues Found
- <issue-1>
- <issue-2>

### Cross-Service Contracts
- <contract check results>
```

### 8d. Post-Validation Cleanup

No cleanup needed. The TDD pipeline never starts containers, so there is nothing to prune. If a dev container was running for `/jlu-start-dev`, leave it alone — its lifecycle is owned by that workflow.

### Step 8e — Materialize the UI E2E suite from SPEC.md (shift-left)

After backend validation passes, author the UI E2E suite for any affected frontend
service so it ships with the change. A service is a **UI service** when its
`services.yaml` `stack` ∈ {`react`, `nextjs`, `vue`, `angular`, `svelte`} (or its
`description` matches `/(react|next\.?js|vue|angular|svelte|frontend|UI app)/i` for
legacy registrations without a `stack`).

For each affected UI service:

1. Resolve its active worktree (`jelou/references/worktree-resolution.md`).
2. If `services/<UI_SERVICE_ID>/user-flow.md` + generated specs already exist → no-op.
3. Otherwise dispatch `jlu-ui-e2e-writer`: `MODE=bootstrap` when no Playwright infra
   exists, else `MODE=derive-from-spec`; `EXPECT=red`. The writer reads `SPEC.md` and
   emits `user-flow.md` + the complete suite (success + non-default-field +
   reference-population + negative/rejection per its rule 4b).
4. Commit the generated `user-flow.md` + specs to the task branch.

This step authors only — it is **pre-deploy**: it does NOT boot a UI server and does
NOT run Playwright (that happens post-deploy under `/jlu-production-like` /
`/jlu-ui-qa-run`). It is a no-op when no UI service is affected.

### Step 8f — Materialize the backend E2E suite from SPEC.md (shift-left)

The backend twin of Step 8e, for parity: a frontend change ships with its Playwright
suite, so a backend change must ship with its controller-level E2E suite — instead of
that suite only ever existing reactively the first time someone runs
`/jlu-production-like`. A service is a **backend service** when its `services.yaml`
`stack` is NOT a UI stack (i.e. ∉ {`react`, `nextjs`, `vue`, `angular`, `svelte`}); the
HTTP-surface gate below — not this definition — decides whether it actually gets a suite.

This step is gated on real HTTP surface area the change **adds or modifies**: run it for
an affected backend service only when this task **introduced or changed an HTTP route
handler the service exposes** — detected runtime-agnostically from the phase's
added/changed lines, NOT from a fixed filename set (so it works beyond NestJS). A route
handler is any of: an HTTP-method decorator (`@Get`/`@Post`/… NestJS, `@app.get`/router
decorators FastAPI), a route registration (`app.get(...)`/`router.post(...)` Express,
`r.Get(...)`/`http.HandleFunc(...)` Go, a `routes/*.php` entry Laravel), or a
controller/handler method wired to a path. Key on the handler appearing in the diff —
NOT on SPEC.md merely *naming* an endpoint, since the spec may name a downstream API the
service only *calls* (that is not an exposed surface and must not trigger authoring). A
backend service whose change exposes no new/changed route handler (pure refactor,
internal helper, worker/cron/queue consumer, migration-only) is skipped with a one-line
note — it has no controller→DB flow to E2E.

For each affected backend service that clears the gate:

1. Resolve its active worktree (`jelou/references/worktree-resolution.md`).
2. If a `test/e2e/**` / `*.e2e-spec.ts` suite already covers the touched endpoints → no-op.
3. Otherwise dispatch `jlu-test-writer` with an **E2E target** (`test/e2e/**`,
   dependencies-only Testcontainers permitted for DB/Redis/etc.), instructing it to
   author the suite from `SPEC.md` following the assertion doctrine in
   `jelou/references/backend-e2e-authoring.md` — every mutating endpoint reads its
   entity back through a fresh request and asserts the DB-persistence + cache side
   effects, never just the HTTP 2xx.
4. Commit the generated `test/e2e/**` suite to the task branch.

This step **authors only** — it does NOT boot the service and does NOT run the E2E
suite (it never starts a Testcontainers dependency). Execution, and the Testcontainers
boot, remain owned exclusively by `/jlu-production-like` (Phase 3.5) — the Testcontainers
carve-out is path-scoped to `test/e2e/**` and the TDD pipeline never *runs* it. It is a
no-op when no affected backend service exposes a touched endpoint.

---

## Step 9 — Success Path

If all validation passes:

1. Update TASKS.md:
   - Status: `validating` → `ready_to_publish`
   - Add completion timestamp
   - Record final test counts
2. Print the final summary directly to terminal — no agent dispatch (orchestrator already has every field from prior steps). Format:

   ```
   ## Execution Complete — <TASK_SLUG>

   Status: ready_to_publish · <N> phase(s) · <C> commit(s) on production/<TASK_SLUG>

   ### Phases
   | NN | Name | Service | Tests | Commit |
   |----|------|---------|-------|--------|
   | 01 | <name> | <service-id> | <pass>/<total> | <sha> |
   | ...

   ### Verification
   - Tier 1 tests: <count> passing
   - Tier 2 tests: <count> passing (or "none — no deferred requirements")
   - Build: <pass | skipped (all phases trivial) | n/a>
   - QA findings: <count>

   ### Files Changed
   <total: +<insertions> / -<deletions> across <N> files>

   ### Next Steps
   - Run `/jlu-ship` to open the pull request.
   - After merge, run `/jlu-close-task`.
   ```

---

## Step 10 — Failure Path

If validation fails or phases have unresolved issues:

1. Log failures to terminal:
   ```
   ## Execution Incomplete — Auto-Retrying Failed Phases

   ### Failed Phases
   - Phase <NN>: <reason>

   ### Failing Tests
   - <test-name>: <failure reason>
   ```

2. Auto-retry each failed phase (re-run the full TDD cycle from Step 7d). Track attempts per phase.

3. If a phase fails after 5 total attempts: pause and notify user (see Escalation Format below).

4. Update TASKS.md with the failure state and details.

---

## Error Handling

| Error | Action |
|-------|--------|
| Task not in `planned` or `implementing` state | Stop with status message |
| SPEC.md missing | Stop — cannot execute without spec |
| Codebase files missing | Warn, proceed (agents will have less context) |
| Test writer agent fails | Kill, spawn fresh with failure context — up to 5 attempts (Decision #1) |
| Implementer agent fails | Kill, spawn fresh with failure context — up to 5 attempts (Decision #1) |
| Tests never go green after 5 retries | Pause and notify user (see Escalation Format) |
| QA auto-fix fails after 5 retries | Pause and notify user (see Escalation Format) |
| Git commit fails | Report error, do not block phase execution |
| Build validation fails after 5 rounds | Pause and notify user (see Escalation Format) |
| Worktree missing | Fall back to main repo, warn user |
| Destructive SQL in Bash command | Block execution, report BLOCKED (SQL Safety Gate) |

---

## Escalation Format

When any retry limit (5 attempts) is exhausted, this is the **only** point where execution pauses for user input. Use `question` with this format:

```
## Execution Paused — Manual Intervention Needed

Phase <NN>: <Phase Name> (<service-id>)
Failure type: <test-writer | implementer | build | qa>
Attempts: 5/5

Last error:
<last error output>

Completed phases: <list>
Remaining phases: <list>

Awaiting your input to proceed.
```

**After user responds**, handle accordingly:
- **Resume phase**: Re-run the failed phase's TDD cycle with user-provided guidance.
- **Skip phase**: Mark phase as `skipped`, continue to next phase.
- **Abort execution**: Stop execution, update TASKS.md with current state.

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| SPEC.md | `.spec-workspace/specs/<date>/<task-slug>/SPEC.md` |
| PROPOSAL.md | `.spec-workspace/specs/<date>/<task-slug>/PROPOSAL.md` |
| TASKS.md | `.spec-workspace/specs/<date>/<task-slug>/TASKS.md` |
| Phase files | `.spec-workspace/specs/<date>/<task-slug>/services/<service-id>/phases/<NN>-<phase>.md` |
| Implementation (Mode: worktree) | `<service-repo>/.worktrees/<task-slug>/` |
| Implementation (Mode: branch) | `<service-repo>` (main repo root, on branch `production/<task-slug>`) |

---

## Decision References

| Decision | Application |
|----------|-------------|
| #4 | Separate test-writer + implementer agents per TDD cycle |
| #5 | Orchestrator mediates test disputes |
| #7 | PROPOSAL.md bridges SPEC.md and implementation |
| #9 | Dependency-driven multi-service execution order |
| #10 | User stories auto-generated from spec in hybrid format |
| #13 | QA: lightweight per-phase + full final validation |
| #19 | Phase files: immutable requirements + mutable execution |
| #21 | Two-pass proposal: global strategy + per-service detail |
| #29 | **Superseded**: always autonomous, execution mode selection removed |
| #35 | **Simplified**: session recovery always auto-resumes from first incomplete phase |
| #36 | Real-time progress in TASKS.md + milestone terminal output |
| #38 | Hybrid user story format |
| #40 | Task branch `production/<task-slug>` across all repos |

---

## Step N — Close workflow span

Determine `$WORKFLOW_OUTCOME`:
- `ok` — all phases done, QA green, ready for `/jlu-ship`
- `blocked` — workflow halted on a phase escalation; user intervention required
- `failed` — workflow aborted (irrecoverable error)

Run:
```bash
node "${PLUGIN_ROOT:-.}/bin/trace-end-span.mjs" \
  --span "$WORKFLOW_SPAN_ID" --status "$WORKFLOW_OUTCOME"
```

Empty `$WORKFLOW_SPAN_ID` (when `TRACE_DISABLED=1`) is tolerated. This is the last step.
