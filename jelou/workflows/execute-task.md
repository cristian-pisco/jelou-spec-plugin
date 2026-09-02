# Workflow: execute-task

> Orchestrator workflow for `/jlu-execute-task [task-slug]`
> Runs TDD implementation with proposal generation, phase-by-phase execution, and final validation.

> **Execution policy**: This workflow runs fully autonomous. The ONLY case where execution pauses for user input is after 5 failed retry attempts on a phase or build step. All other decisions are auto-resolved.

> **SQL Safety Gate**: inject the block from `jelou/references/sql-safety.md` into every Bash-capable agent prompt (test-writer, implementer, build-validator).

---

## Principles

> **Minimum viable work. Verify before proceeding. Escalate before guessing.**

- Each phase follows strict TDD: Red -> Green -> Refactor. No shortcuts.
- Agents write the minimum code to satisfy tests. Over-engineering is a defect.
- Every phase must end with verified green tests before the next phase starts.
- When something fails after 5 retries, escalate to the user — don't hack around it.
- Every phase boundary is exactly two Bash calls: `bin/phase-open.mjs` before the dispatch, `bin/phase-close.mjs` after it. If you find yourself running `git`, `classify-phase.sh`, `finalize-phase.sh`, `format-changed-files.sh` or `phase-state.mjs` by hand inside the loop, you are doing the script's job.

**When to simplify:** For single-file, single-function changes with no cross-service impact, the orchestrator may consolidate multiple phases into one if PROPOSAL.md supports it. The TDD cycle within each phase is never skipped.

---

## Step 0.5 — Trace bootstrap

> ## TRACING IS OFF BY DEFAULT — resolve `TRACING_ON` here, once, and nowhere else
>
> `TRACING_ON` is **TRUE only when the env var `JLU_TRACE=1`**. Unset, `0`, or any
> other value is FALSE. `TRACE_DISABLED=1` forces FALSE whatever `JLU_TRACE` says.
> There is no third state and no per-step re-derivation.
>
> **When `TRACING_ON` is false, this workflow emits ZERO trace Bash calls.** Not the
> orphan sweep, not the suggester, not the workflow span, not the phase spans (they
> ride inside `bin/phase-open.mjs` / `bin/phase-close.mjs` and only load the trace
> layer when handed span flags), not the agent-dispatch wrapper (7b), not the
> affected-tests spans (8b.4), not the Step N close. Every `*_SPAN_ID` and
> `*_TRACE_ID` stays empty and every step that depends on one is **skipped
> outright** — no call, no `jq`, no no-op. Skipping the script was never the saving;
> skipping the *call* is.
>
> **Tracing tolerance (only when `TRACING_ON` is true)**: every
> `trace-start-span.mjs` invocation captures stdout JSON; downstream
> `trace-end-span.mjs` calls and `jq` lookups must tolerate empty values without
> failing the workflow.

**Steps 0.5 §1, §2 and 0.5b below run ONLY when `TRACING_ON` is true. When it is
false, do none of them — go straight to Step 1.**

1. **Sweep orphans from any prior interrupted run** (idempotent):
   ```bash
   node "<root>/bin/trace-reconcile.mjs"
   ```
   `reconciled: <N>` is informational. A non-zero exit does not fail the workflow — tracing is best-effort.

2. **Open the workflow-level span** (deferred to the end of Step 1, when `$TASK_SLUG` is known):
   ```bash
   WF_OUT=$(node "<root>/bin/trace-start-span.mjs" \
     --name execute_task --scope task --task "$TASK_SLUG")
   WORKFLOW_SPAN_ID=$(echo "$WF_OUT" | jq -r '.span_id // ""')
   WORKFLOW_TRACE_ID=$(echo "$WF_OUT" | jq -r '.trace_id // ""')
   ```
   Store both for the duration of the workflow. Empty strings are valid when `TRACE_DISABLED=1`.

### Step 0.5b — Surface suggestions from prior runs (non-blocking)

**Skip this entire sub-step when `TRACING_ON` is false — it shells out, so it is a
trace Bash call like any other.**

Once `$TASK_SLUG` is resolved (Step 1), run the suggester scoped to the current task. It emits one SUGGEST block per active rule that fires; the 7-day cooldown is honored automatically.

```bash
SUGGESTIONS=$(TRACE_CURRENT_TASK="$TASK_SLUG" node "<root>/bin/trace-suggest.mjs" 2>/dev/null || true)
```

Telemetry MUST NOT interrupt execution. Non-empty → print the blocks as one informational note (`Prior-run suggestions (run /jlu-refine-task or /jlu-trace-report to act):`) and continue immediately. Do NOT use `question` / `AskUserQuestion`, and do NOT write to `suggestion-history.jsonl` — nothing was decided, so no cooldown starts. Empty → continue silently. Interactive y/n approval of these suggestions lives only in `/jlu-refine-task` and `/jlu-trace-report`.

---

## Step 1 — Resolve Task

Read `.spec-workspace.json` once at the start of this step (if present) and cache it as `WORKSPACE_CONFIG`. Reuse this cached object in Step 2b instead of reading the file again.

**Argument parsing.** The invocation may carry up to four tokens: the first
non-flag, non-ClickUp token is the `task-slug`; a ClickUp URL
(`app.clickup.com/t/<id>`) or bare ClickUp id token is captured for Step
9.5a (never treated as a slug); `--no-autochain` is captured for the Step
9.5 gate; `--refactor` is captured for the Step 8a.3 opt-in gate. Strip the
captured tokens before slug resolution.

`WORKSPACE_PATH` is `WORKSPACE_CONFIG.workspace`.

**Resolution is one script call, not a directory walk.** The orchestrator never
searches `<WORKSPACE_PATH>/specs/` across date folders and never parses `TASKS.md`
to derive task state — `bin/task-index.mjs` owns both, deterministically and
unit-tested.

1. If a `task-slug` was parsed from the invocation, use it verbatim as `<IDENT>`.
2. If not, take the newest task from the index and log `Auto-selected task <slug>.`:
   ```bash
   IDENT=$(node <plugin-root>/bin/task-index.mjs list --json --workspace "<WORKSPACE_PATH>" \
     | jq -r '.[0].slug // empty')
   ```
   `list --json` is ordered newest date first (slug-ascending within a date — the
   index has no intra-day creation order, so the first row is the deterministic
   choice, not necessarily the last one you created).
3. Resolve the full record in one invocation:
   ```bash
   TASK_JSON=$(node <plugin-root>/bin/task-index.mjs get "$IDENT" --json --workspace "<WORKSPACE_PATH>")
   ```

**Exit codes** (do not paper over them): `2` no spec workspace → stop, surface stderr
verbatim. `6` no task matches `<IDENT>` → stop: "No task found. Run `/jlu-new-task`
first." `7` the slug matches several date folders → stderr lists the full
`<date>/<slug>` keys; re-invoke `get` with the newest-dated one and log which you took.
Never ask.

**Store — parse `TASK_JSON` once; nothing downstream re-derives any of these:**
`TASK_SLUG` = `.slug`; `TASK_DIR` = `<WORKSPACE_PATH>/` + `.root_path` (workspace-relative);
`CURRENT_STATUS` = `.status`; `AFFECTED_SERVICES` = `.services[].id` (`.services[].role`
marks the `primary`); `PHASE_STATE` = `.phases` (`[{ordinal, phase_number, heading,
status}]`, status ∈ `pending|in_progress|done|blocked`); `SETUP_MODE` = `.setup_mode`
(from `## Branching → Mode`; `null` means `worktree`).

Also store `WORKSPACE_PATH`, `WORKSPACE_CONFIG` and the parsed `TASK_JSON` itself. Log
`.derivation_issues` as one-line WARNs when non-empty — informational only; the
validation below is what stops the workflow.

---

## Step 2 — Validate Task State

No file is read here. Everything this step gates on came from `TASK_JSON` in Step 1.

**Validation**:
- If `CURRENT_STATUS` is `draft` or `refining`: stop. "Task is in `<status>` state. Run `/jlu-new-task <slug>` first to complete the spec interview and get it to `planned`."
- If `CURRENT_STATUS` is `closed` or `cancelled`: stop. "Task is already `<status>`. Cannot execute."

**Store**: `CURRENT_STATUS`, `AFFECTED_SERVICES`, `PHASE_STATE`, `SETUP_MODE` (all from Step 1)

---

### 2b. Resolve Model Configuration

1. Reuse `WORKSPACE_CONFIG` loaded in Step 1 (do not re-read `.spec-workspace.json`).
2. If a `models` section exists in `WORKSPACE_CONFIG`, extract the model overrides.
3. Store as `MODEL_CONFIG` — a map of group name → model name.
4. When spawning agents in subsequent steps, resolve the model:
   - For proposal-agent: use `MODEL_CONFIG.proposal` or default `"sonnet"`
   - For test-writer, implementer, build-validator: use `MODEL_CONFIG.code` or default `"sonnet"`
   - For git-agent: use `MODEL_CONFIG.operational` or default `"haiku"`

---

### 2c. Dispatch prompts (referenced by every subagent dispatch below)

Every `jlu-proposal-agent`, `jlu-tdd-cycle`, `jlu-test-writer`, `jlu-build-validator`
and `jlu-implementer` dispatch in this workflow gets its prompt from
`bin/build-dispatch-prompt.mjs`. **The orchestrator does not compose agent prompts.**

```bash
node <plugin-root>/bin/build-dispatch-prompt.mjs \
  --agent=<proposal-agent|tdd-cycle|test-writer|build-validator|implementer> \
  --task-dir="<TASK_DIR>" \
  --service="<service-id>" \
  --plugin-root="<PLUGIN_ROOT>" \
  [--phase-file="<abs path to the phase file>"] \
  [--notes-file="<abs path to a notes file>"]
```

On a phase's first dispatch you never run this yourself — `bin/phase-open.mjs` (7c)
runs it for you and prints the prompt. Everywhere else — 4b, 4c, 8a, 8a.5, 8b.5, and a
7d **retry** (which must not re-open the phase span) — you run it directly and dispatch
its stdout **verbatim**, wrapped in the 7b span wrapper.

`--plugin-root` is how `<PLUGIN_ROOT>` reaches the agent: it becomes the `PLUGIN_ROOT`
row of `## CONTEXT`, which is the only way an agent can resolve a bundled bin (see
`jelou/references/plugin-root.md`). Passing it is not optional for any dispatch.

The script is deterministic (byte-identical for identical inputs) and owns every
section of the prompt: `## CONTEXT`, the phase's immutable `## Requirements`,
`## EXISTING FOUNDATION`, the `## CASE MATRIX` copied from the phase's `## Acceptance`,
the byte-invariant `## HARD CONSTRAINTS`, `## PROCEDURE`, `## RETURN`.

**Never restate a section the script emits.** `--phase-file` is required for
`tdd-cycle`, accepted by `test-writer` and `implementer`, ignored elsewhere. Exit 2 is
bad input (unknown agent, missing task dir, missing `<TASK_DIR>/services/<service-id>/`,
missing phase file) — an orchestrator bug: fix the arguments, never hand-write the
prompt instead.

**`--notes-file` is the only escape hatch**, for context the script cannot derive.
Write it to `<TASK_DIR>/services/<service-id>/phases/<NN>-reports/notes-<agent>-<round>.md`
(`.../phases/final-reports/notes-<agent>.md` outside the phase loop); it renders as a
trailing `## ORCHESTRATOR NOTES`. Legitimate contents, and nothing else: a prior
attempt's failure context (per 7a); a list the orchestrator aggregated across phases
and the script cannot see; which pass of a two-pass proposal this is; a repo convention
that the phase file does not state; the `SERVICE_SOURCE_PATH` override below. Never
requirements, acceptance, constraints, procedure or return format.

**Known gap — `SERVICE_SOURCE_PATH` is not always derivable.** The script reads it from
`TASKS.md → ## Worktrees`, which exists only for `Mode: worktree` tasks. When
`SETUP_MODE = branch` (no such section), or when Step 6 resolved a service to its main
repo because the declared worktree was missing, the `## CONTEXT` row is absent while
`## HARD CONSTRAINTS` still orders the agent to stay inside `SERVICE_SOURCE_PATH` —
leaving it with no working directory. In those two cases every `tdd-cycle` /
`test-writer` / `implementer` / `build-validator` notes file MUST open with:

```
SERVICE_SOURCE_PATH: <SERVICE_SOURCE_PATH[service-id]>
This overrides `## CONTEXT`, which omits the row: <branch-mode | worktree missing, using the main repo>.
```

`proposal-agent` is exempt — it writes planning artifacts only.

---

## Step 3 — Session Recovery

**Already-complete resume (status is `ready_to_publish`).** Implementation is
finished and committed on `production/<TASK_SLUG>`, but the ship+green chain did
not complete in the originating session (context death, aborted window, or the
chain simply never ran). Do NOT re-run phases or final validation — the work is
done. Resolve the autochain flag per §2 of
`{plugin-root}/jelou/references/autochain-handoff.md` (precedence:
`--no-autochain` argument > `JLU_AUTOCHAIN` env >
`node {plugin-root}/bin/jlu-settings.mjs get autochain`), then:

- Resolved `true` → skip Steps 3b–9 entirely and go straight to **Step 9.5**,
  which ships inline and drives every PR to green. Step 9.5 handles its own
  re-entry: if `<TASK_DIR>/AUTOCHAIN.json` already exists (a chain that died
  *after* ship opened PRs) it resumes from that artifact; otherwise it runs the
  first ship. **Never ask the user to confirm shipping** — an on-flag chain
  ships autonomously. This is the missing counterpart to autochain-handoff §4:
  it carries a `ready_to_publish` task into the chain on the *first* ship, not
  only on post-ship re-entry.
- Resolved not `true` → the chain is opt-out for this task; print the Step 9
  chain-off block (the `## <TASK_SLUG>` heading plus
  `- Run /jlu-ship to open the pull request.`) and stop.

Otherwise, read the mid-execution state off `PHASE_STATE` (Step 1) — do NOT re-read
`TASKS.md`. A resume is `CURRENT_STATUS == implementing` AND `PHASE_STATE` holds at
least one entry whose `status` is `done` alongside at least one that is not:

1. Log the current state to terminal:
   ```
   Task `<TASK_SLUG>` — resuming interrupted execution.
   Completed: Phase 01, Phase 02
   Resuming from: Phase 03
   ```

2. For every `PHASE_STATE` entry whose `status` is `in_progress` (interrupted
   mid-execution):
   - Write that phase's status back to `pending` in TASKS.md and in the phase file.
   - Log to terminal: "Phase <NN> was interrupted. Restarting from scratch."

3. Set `RESUME_FROM` = the first `PHASE_STATE` entry in `ordinal` order whose `status`
   is not `done`. Skip to Step 7, starting from that phase.

---

## Step 3b — Mode Detection and Auto-Checkout (Decision gate)

Use `SETUP_MODE` from `TASK_JSON` (Step 1) — do not re-read `TASKS.md`:

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

Do NOT preload `ENGINEERING_PRINCIPLES.md` into the orchestrator. The proposal-agent has `Read` access and pulls it itself. Preloading would balloon every subsequent agent dispatch in the task with 30–80k tokens of context the orchestrator does not need. Nothing under `codebase/` is read by anyone.

### 4b. Global Strategy Pass

Build the prompt per §2c with `--agent=proposal-agent --service=<the `primary` service
in `TASK_JSON.services`, else the first in `AFFECTED_SERVICES`>` and dispatch with
model: **MODEL_CONFIG.proposal** (default: sonnet). Do NOT inline SPEC.md — the script
gives its path and the agent reads it, which is 4a's discipline.

Notes file — only what the script cannot see:

```
PASS: global
AFFECTED SERVICES: <one line per service: its `services.yaml` entry {id, path, stack, docker?}>
ALSO READ: <WORKSPACE_PATH>/principles/ENGINEERING_PRINCIPLES.md and <WORKSPACE_PATH>/registry/services.yaml. For each affected service, grep its source tree at its `path` for the modules the task touches. Never read anything under <WORKSPACE_PATH>/services/<service-id>/codebase/.
TASK: Produce the global proposal — cross-service strategy, dependency order, phase structure, contract boundaries, risks, testing strategy.
```

### 4c. Local Detail Pass (Multi-Service Only)

If there are **2+ affected services**, spawn one `jlu-proposal-agent` per service, model: **MODEL_CONFIG.proposal** (default: sonnet).

**Compute `TASK_FANOUT_CAP` NOW — this is its first point of use** (this step runs before Step 6 sets the task-level throttles). Invoke the planner's cap-only mode and cache the number for every later consumer (Steps 6, 7d, 8a.3, 8a.5, 8b.4):

```bash
TASK_FANOUT_CAP=$(node <plugin-root>/bin/plan-phase-waves.mjs --emit-cap-only --limit=<N_affected_services>)
```

The cap formula lives ONLY in the planner (`bin/plan-phase-waves.mjs` — auto cap from host cores, with `JLU_PHASE_PARALLELISM` applied as a reduce-only manual ceiling); never restate it in this workflow. Honor `TASK_FANOUT_CAP`: when `> 1`, fan out in a single orchestrator message; when `= 1`, dispatch sequentially.

Each prompt is built per §2c with `--agent=proposal-agent --service=<service-id>` and a per-service notes file carrying `PASS: local — <service-id>`, the global strategy draft (its path, or the text when it is not yet on disk), the target service's `services.yaml` entry (its `path` is what the agent greps — never anything under `codebase/`), and the task: *expand service-specific execution details — local scope, relevant modules, implementation constraints, service-level phases*.

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

2. **Per-service setup — ONE call for the whole task, not one per service and not one per phase.**

   ```bash
   node <plugin-root>/bin/task-setup.mjs \
     --workspace="<WORKSPACE_PATH>" \
     --task-slug="<TASK_SLUG>" --setup-mode="<SETUP_MODE>" \
     --services="<AFFECTED_SERVICES as a comma-separated list>"
   ```

   It emits `status=ok`, `setup_mode=`, `fanout_cap=` and, per service, a
   `service.<id>.` block: `source_path`, `resolution`, `baseline_sha`. Parse it once
   and store:

   - `SERVICE_SOURCE_PATH[service-id]` = `service.<id>.source_path`. The script applies
     the **mode-driven** algorithm of `references/worktree-resolution.md`, NOT a
     filesystem existence check: `Mode: worktree` resolves to
     `<service-repo>/.worktrees/<TASK_SLUG>/` and falls back to the main repo with a
     WARN when that path is missing (`resolution=worktree_missing_fallback_main_repo`);
     `Mode: branch` resolves to the **main repo** root and ignores any leftover worktree
     on disk, logging it as a WARN
     (`resolution=branch_mode_leftover_worktree_ignored`) — remove that leftover worktree
     with `git worktree remove` when you want it gone. A legacy task with no
     `## Branching` section defers to `references/worktree-resolution.md` §3c.
   - `TASK_FANOUT_CAP` = `fanout_cap` when Step 4c did not already compute it. The
     script gets the number from `plan-phase-waves.mjs --emit-cap-only --limit=<N>`,
     which is the single source of the formula.

   `status=abort` + `reason=<missing_argument|workspace_missing|no_services>`
   is an orchestrator bug — fix the arguments, never hand-resolve the paths instead.

   **Do NOT** run `docker compose up -d`, `docker compose ps`, or compute any container
   exec prefix here. The TDD pipeline runs entirely on the host — tests, build, lint and
   format never go through a container. A dev container is `/jlu-start-dev`'s job and is
   independent of this workflow.

3. Update TASKS.md with the per-service baselines:
   ```markdown
   ## Commit Tracking
   - <service-id-1> pre-execution commit: <sha>
   - <service-id-2> pre-execution commit: <sha>
   ```

**Store** (per-service map): `SERVICE_SOURCE_PATH`.

4. **Set local CPU safety throttles (once per task).**

   - `PHASE_PARALLELISM`: default `auto` for Step 7. The wave planner (`bin/plan-phase-waves.mjs`) resolves `auto` to a numeric cap itself and reports it as `auto_cap`/`chosen_cap` in the wave-plan JSON; `JLU_PHASE_PARALLELISM`, when set, is a manual ceiling the planner applies reduce-only. The planner is the single source of the cap formula — this workflow never restates or recomputes it. Same-service safety does not depend on the cap value: the planner enforces at-most-one-phase-per-service-per-chunk unconditionally.
   - `TASK_FANOUT_CAP`: the numeric cap for every orchestrator-side fan-out comparison (Steps 4c, 7d, 8a.3, 8a.5, 8b.4). Cached at its first point of use — Step 4c, or Step 6.2's `fanout_cap` when 4c did not run. Later steps reference the cached value; they never re-derive it.

The orchestrator never runs the full test suite — Step 8b is an **affected-tests** regression check only. The full suite is owned by the dedicated `/jlu-test-suite` skill, invoked on demand before opening a PR. `JLU_FINAL_TEST_PARALLELISM` and `JLU_TEST_MAX_WORKERS` are no longer read here; see `jelou/references/parallel-dispatch.md`.

**Store** (task-level): `PHASE_PARALLELISM` (the value handed to the planner, resolved only by the planner), `TASK_FANOUT_CAP`.

---

## Step 7 — Execute Phases

The orchestrator does not iterate phases as a flat sequence — it builds a **wave plan**
first (per-service lanes), then iterates wave-by-wave with cross-service parallelism
inside each wave.

**Each phase costs exactly three orchestrator turns**: `bin/phase-open.mjs` (7c), the
agent dispatch (7d), `bin/phase-close.mjs` (7e). A docs-mode phase costs two.

### 7.0. Wave Planning (cross-phase parallelism gate)

Read PROPOSAL.md's `## Execution Strategy` section: `sequential` (or missing) is the
conservative default; `per-service-parallel` is the proposal-agent's opt-in, made there
because only it can see whether services share cross-service contracts that gate one
another. The orchestrator honors the decision and never promotes one.

Build the plan — `bin/plan-phase-waves.mjs` owns the grouping, the `**Needs:**` edges,
the phase-id parsing (`03a-name.md` → `03a`) and the chunking, so the orchestrator never
improvises any of it:

```bash
node <plugin-root>/bin/plan-phase-waves.mjs \
  --task-dir="<TASK_DIR>" \
  --strategy="<STRATEGY>" \
  --phase-parallelism="<PHASE_PARALLELISM>"
```

**Output** — one JSON object on stdout. Parse it once, store as `WAVE_PLAN`, and iterate
`WAVE_PLAN.waves` for the rest of Step 7:

```json
{
  "strategy": "sequential" | "per-service-parallel",
  "phase_parallelism": <N>,
  "auto_cap": <N>,
  "chosen_cap": <N>,
  "downgrade_reason": "<only present when the planner downgraded the strategy>",
  "lanes": { "<service-id>": [{ "phase": "01", "phase_file": "<abs path>" }, ...] },
  "waves": [
    [{ "service": "<service-id>", "phase": "<NN>", "phase_file": "<abs path>" }, ...],
    ...
  ],
  "summary": "<one-line summary suitable for terminal>"
}
```

`downgrade_reason` present → log it as a one-line WARN and continue with the plan as
emitted. Log `WAVE_PLAN.summary` once, then one line per wave:
`Wave <i>/<total>: <K> phase(s) — <list of "<service>:<NN>" pairs>.`

Each emitted wave lists the phases that may run together. Intra-service `**Needs:**`
edges can place more than one phase of the *same* service on the same dependency
**level** (absent `**Needs:**`, each phase defaults to depending on its predecessor) —
but a level is not a wave. The planner chunks every level by `chosen_cap` and admits
**at most one phase per service per chunk, unconditionally**, so `WAVE_PLAN.waves` as
emitted never contains two phases of the same service: independent same-service phases
are serialized across consecutive waves.

**Corollary — a single-service task never gets phase-level parallelism.** With one
affected service every chunk holds at most one phase by that same invariant, whatever
`chosen_cap` resolves to. Phase-level parallelism is structurally impossible there;
raising the cap changes nothing.

#### Concurrency cap

The plan arrives pre-chunked. The orchestrator consumes it as emitted — it never
recomputes, restates or overrides the cap. Two planner invariants replace any
orchestrator-side clamp: at-most-one-phase-per-service-per-chunk, unconditionally,
whatever the cap's value or origin; and `JLU_PHASE_PARALLELISM` as the planner's
reduce-only manual ceiling, so no env var can raise concurrency above the planner's
own number. When `chosen_cap = 1` the wave plan serializes each wave's phases —
sequential is still the outcome, just iterated wave-by-wave.

#### Per-wave execution

For each wave:

1. **Dispatch all phases in the wave concurrently** — one orchestrator message carrying all the wave's calls. See `jelou/references/parallel-dispatch.md` for the concurrency pattern, scope-isolation rules and conflict detection on return.
2. **Wait for every phase in the wave to reach a terminal state (`done`, `failed`, `skipped`) before starting the next wave.** A phase that errors blocks only its lane; the wave does not advance until every phase in it is terminal.
3. **Within each phase**, 7c → 7d → 7e apply unchanged. Whether phases run sequentially or in parallel is governed by the wave-level dispatch only.

If a phase in a wave hits the 5-retry pause (Escalation Format), the orchestrator pauses the whole workflow at that wave. Phases in the same wave that already completed stay `done` and are NOT re-run when the user resumes.

### 7a. Report Persistence Discipline (context-saturation guard)

For every sub-agent dispatched inside this loop (`jlu-tdd-cycle`, and any
`jlu-implementer` retry), the orchestrator MUST:

1. **Parse the agent's full report** as the tool result, immediately.
2. **Persist it to disk** at `<TASK_DIR>/services/<service-id>/phases/<NN>-reports/<agent-name>-<round>.md`. Round suffix is `1` for the first dispatch in this phase, `2` for the first retry, etc. Create the parent directory on first write.
3. **Keep only a structured digest in working memory** for downstream gating:

   ```json
   {
     "agent": "jlu-tdd-cycle",
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
     "report_path": "<TASK_DIR>/services/.../<NN>-reports/jlu-tdd-cycle-1.md"
   }
   ```

   Capture only the fields later steps gate on. The full prose stays on disk for audit.
4. **When a downstream step needs the full report** (8a.3 needs each phase's `Refactor Candidates`), re-read it from disk instead of relying on conversation history.
5. **Failure-context recycling**: when retrying a failed agent (up to 5 attempts), pass only the digest + the last 50 lines of the previous attempt's failure output. The agent reads its predecessor's full report from disk if it needs more.

Each report is 500–2000 tokens; a 10-phase task would otherwise accumulate 20–80k tokens of report prose and force compaction mid-task. Persist-and-digest caps the per-phase working-memory increment at ~200 tokens.

### 7b. Agent dispatch wrapper (referenced by every subagent dispatch below)

**Guard: this whole wrapper exists only when `TRACING_ON` (Step 0.5) is true.**
When it is false, dispatch the agent bare — emit no `trace-start-span.mjs` call,
no `trace-end-span.mjs` call, and do not extract the measurement fields below for
a span that will not exist. That is two Bash calls saved per dispatch.

When `TRACING_ON` is true, each subagent dispatch (tdd-cycle, implementer, test-writer, refactor-agent, build-validator) is wrapped in a span pair.

**Before the dispatch:**
```bash
DS_OUT=$(node "<root>/bin/trace-start-span.mjs" \
  --name agent_dispatch --scope task \
  --agent "<agent-role>" --model "$MODEL_FOR_AGENT" \
  --task "$TASK_SLUG" --service "$SERVICE_ID" --phase "$PHASE_NUM" \
  --phase-parallelism "$WAVE_CHOSEN_CAP" \
  --wave-index "$WAVE_INDEX" --wave-width "$WAVE_WIDTH" \
  --parent "$PHASE_SPAN_ID" --trace "$WORKFLOW_TRACE_ID")
DISPATCH_SPAN_ID=$(echo "$DS_OUT" | jq -r '.span_id // ""')
```

`<agent-role>` is the literal role (`test-writer`, `implementer`, `tdd-cycle`, `refactor-agent`, `build-validator`). `$MODEL_FOR_AGENT` comes from `MODEL_CONFIG` (Step 2b). Measurement attrs: `$WAVE_CHOSEN_CAP` = `WAVE_PLAN.chosen_cap`; `$WAVE_INDEX` = 1-based index of the current wave; `$WAVE_WIDTH` = phases dispatched concurrently in the current chunk. For dispatches outside the wave loop (8a.3, 8a.5), pass `--phase-parallelism "$TASK_FANOUT_CAP"` and omit the two wave flags.

**After parsing the agent's JSON report**, extract `$AGENT_STATUS` (`ok`/`blocked`/`failed`/`escalated`), `$AGENT_RETRIES`, `$AGENT_OUTCOME`, `$DIFF_SIZE_LOC` (LOC added+removed over reported artifacts), `$ERROR_SIG` (`sha256(normalized_error_message)[:8]`, only on `blocked`/`failed`), and `$TOKENS_IN` / `$TOKENS_OUT` when the runtime exposes `usage.input_tokens` / `usage.output_tokens`. All but the first are best-effort. Then close:

```bash
node "<root>/bin/trace-end-span.mjs" \
  --span "$DISPATCH_SPAN_ID" --status "$AGENT_STATUS" \
  ${AGENT_RETRIES:+--retries "$AGENT_RETRIES"} \
  ${AGENT_OUTCOME:+--outcome "$AGENT_OUTCOME"} \
  ${DIFF_SIZE_LOC:+--diff-size "$DIFF_SIZE_LOC"} \
  ${ERROR_SIG:+--error-sig "$ERROR_SIG"} \
  ${TOKENS_IN:+--tokens-in "$TOKENS_IN"} \
  ${TOKENS_OUT:+--tokens-out "$TOKENS_OUT"}
```

Empty `DISPATCH_SPAN_ID` (when `TRACE_DISABLED=1`) makes the close a no-op. When `TRACING_ON` is true this wrapper applies to every `task` (OpenCode) / `Agent` (Claude Code) dispatch below; when it is false it applies to none of them.

### 7c. Open the phase — one call

`bin/phase-open.mjs` is the whole pre-dispatch half of a phase. It chains, in order:

1. `bin/classify-phase.sh mode` — docs vs tdd, from the phase file alone. It never
   touches `git diff`, so it cannot mistake a clean tree for a trivial phase.
2. `bin/build-dispatch-prompt.mjs --agent=tdd-cycle` (skipped in docs mode) — the
   dispatch prompt, per §2c.
3. `bin/phase-state.mjs --event=start` — phase file `Status: in_progress`, the TASKS.md
   phase status and the start timestamp, and the phase span when the span flags are
   present (it imports `bin/lib/trace/emitter.mjs` directly, so no extra process is
   spawned and no separate Bash call is ever needed for the span).

```bash
node <plugin-root>/bin/phase-open.mjs \
  --task-dir="<TASK_DIR>" --service="<service-id>" --phase="<NN>" \
  --phase-file="<PHASE_FILE>" --phase-title="<Phase Name>" \
  --plugin-root="<PLUGIN_ROOT>" --services-in-phase="<K>" \
  [--notes-file="<abs path>"] \
  [--span-parent="$WORKFLOW_SPAN_ID" --span-trace="$WORKFLOW_TRACE_ID" --task-slug="$TASK_SLUG"]
```

`<K>` is how many services own this phase id: count the `WAVE_PLAN.lanes` entries whose
lane contains this `phase`. Derive it from `lanes`, never from the current wave chunk —
at `chosen_cap = 1` the planner splits a two-service phase across two chunks, and
counting the chunk would report `1` for a phase that is genuinely multi-service, which
would let 7e classify it trivial.

**The three `--span-*` / `--task-slug` flags are passed ONLY when `TRACING_ON`
(Step 0.5) is true.** Without them the trace layer is never loaded.

**Nothing from `<WORKSPACE_PATH>/services/<service-id>/codebase/` is ever passed to a
phase dispatch** — not as contents, not as a path. Those documents are written for
humans; agents derive conventions, structure and stack from the source tree itself
(`jelou/references/subagent-base.md` → Context Discipline forbids reading them).
Add `--notes-file` only for a retry's failure context or a `SERVICE_SOURCE_PATH`
override (§2c).

**Output (key=value on stdout)**: `status=ok`, `phase=`, `service=`, `mode=docs|tdd`,
`fr_nfr_count=`, `frontmatter_override=docs|vertical|horizontal|trivial|none`,
`mode_reason=frontmatter_override_validated|docs_override_rejected|legacy_mode_override|default`,
`phase_status=in_progress`, `started_at=`, `grammar=`, `tasks_md=`, `phase_file=`, plus
`span_id=` / `trace_id=` when the span flags were passed, and finally `prompt=below|none`.
Store `PHASE_SPAN_ID` = `span_id` (it feeds 7b and 7e's close) and `PHASE_MODE` = `mode`.

When `prompt=below`, everything after the `----- DISPATCH PROMPT -----` line is the
agent prompt. Dispatch it **verbatim** in 7d. Do not re-read the phase file, do not
re-state its requirements, do not add a preamble.

`status=abort` + `reason=<missing_argument|task_dir_missing|phase_file_missing|classify_failed|prompt_build_failed|…>`
exits non-zero and is an orchestrator bug — fix the arguments, never fall back to
hand-editing TASKS.md or hand-writing the prompt.

**Docs mode.** `mode=docs` means the phase file carries an explicit `**Mode: docs**` /
`mode: docs` frontmatter AND zero code-change verbs (`implement`, `add endpoint`,
`wire`, `inject`, `migrate`, `handler`, `controller`, `service`, `module`) in its
requirements. Heuristic-only docs detection is forbidden — the orchestrator cannot
promote a phase to docs from inference. No prompt is emitted: skip 7d entirely and go
to 7e with `--docs`, which scope-checks and commits the documentation edits already on
the task branch.

Log the milestone to terminal (free — no tool call):

- `Phase <NN> mode: docs (<N> doc requirements, <K> service(s)) — skipping TDD pipeline, going to commit-only path.`
- `Phase <NN> mode: tdd (<N> FR/NFR, <K> service(s)) — dispatching jlu-tdd-cycle.`

### 7d. TDD Cycle — dispatch the authoring agent

**Skipped when `PHASE_MODE == docs`.**

Dispatch `jlu-tdd-cycle` with the prompt 7c printed, model **MODEL_CONFIG.code**
(default sonnet), wrapped in the 7b span wrapper. The prompt already carries the
phase's immutable requirements, the `## EXISTING FOUNDATION` digest of earlier phases,
the `## CASE MATRIX` copied verbatim from `## Acceptance`, `TEST_TIER: 1`, the source
path, and the RED→GREEN procedure and report format.
**Nothing above is restated here or in the dispatch.**

For a multi-service phase, 7c runs once per service and the resulting dispatches go out
in a single orchestrator message when `TASK_FANOUT_CAP > 1` (sequential otherwise) —
see `jelou/references/parallel-dispatch.md`. After all return, compare `artifacts`
arrays to detect cross-service file overlap.

**Verification (trust-the-report)**: the agent already ran every slice's tests in its
own session and reports `Status` + `Command:` + a per-slice table. Trust it when the
report includes `Status: GREEN` AND a `Command:` line AND an all-GREEN slice table.
Only re-run the listed test files locally when the report is incomplete or flags
`status: blocked`. On a genuine failure (local re-run shows red where the agent
reported green, or the agent reports blocked), build a fresh prompt per §2c with a
notes file carrying the accumulated failure context and spawn a new `jlu-tdd-cycle`;
retry up to 5 times total; pause and notify the user after the 5th (Escalation Format).

Carry into 7e, from the report: the union of `Files Modified` + `Tests Written`, the
final `Command:` line, the test counts, the `Artifacts` list, any `Deviations`, and
`$AGENT_RETRIES`.

### 7e — Close the phase — one call

`bin/phase-close.mjs` is the whole post-dispatch half of a phase. It chains, in order,
aborting at the first failure so nothing half-lands:

1. `bin/format-changed-files.sh` over the `Files Modified` + `Tests Written` union.
2. **The Green re-check**, gated on what the formatter actually did. `changed_by_format=0`
   → the formatter touched nothing, so Green cannot have moved; it emits
   `green_recheck=skipped` and logs `Green re-run skipped.` `changed_by_format>0` →
   it re-runs `--green-recheck-command` (the agent's own `Command:` line) inside the
   source path, bounded by `JLU_PHASE_RECHECK_TIMEOUT_MS` (default 600 000 ms). The
   command is screened by `bin/guard-test-commands.mjs` first, so an uncapped or bare
   full-suite command is refused, never run. Give the Bash call a timeout above that
   bound so the script — not the tool — owns the deadline.
3. `bin/classify-phase.sh all` — **After Green is verified**, triviality against the
   real diff. This is why it runs here and not at 7c: the classifier is a size gate
   over the phase's diff, which only exists once the tdd-cycle has written the code.
   Classifying pre-dispatch would return `trivial=true` on a clean tree for every
   single-service phase and silently disable 8a.3's refactor pass for essentially every
   task. `all` also re-derives the `mode: trivial` frontmatter override internally, so
   there is nothing for the orchestrator to thread through from 7c.
4. `bin/finalize-phase.sh` — branch pre-flight, scope check, stage, commit, rev-parse.
5. `bin/phase-state.mjs --event=end` — phase file `Status:`, TASKS.md status, test
   counts, artifacts, deviations, the commit SHA `finalize-phase.sh` just returned
   (never a second `git rev-parse`), the completion timestamp, and the phase span close.

```bash
node <plugin-root>/bin/phase-close.mjs \
  --task-dir="<TASK_DIR>" --service="<service-id>" --phase="<NN>" \
  --phase-file="<PHASE_FILE>" --phase-title="<Phase Name>" \
  --source-path="<SERVICE_SOURCE_PATH[service-id]>" --task-slug="<TASK_SLUG>" \
  --commit-type="<feat|fix|docs|refactor|test>" \
  --changed-files="<Files Modified + Tests Written, comma-separated>" \
  --green-recheck-command="<the agent's Command: line>" \
  --services-in-phase="<K>" \
  --tests-passed="<N>" --tests-total="<N>" \
  --artifacts="<comma-separated paths from the report>" \
  [--deviations="<one line, as the agent reported it>"] \
  [--status="<done|blocked|failed>"] \
  [--span="$PHASE_SPAN_ID" --span-status="$PHASE_OUTCOME" \
   --span-success="$PHASE_SUCCESS" --span-attempts="$PHASE_ATTEMPTS"]
```

**Docs-mode phases** pass `--docs` instead of `--commit-type` / `--changed-files` /
`--green-recheck-command`: the script derives its scope from the working tree (tracked
modifications **and** untracked-but-not-ignored files, so a brand-new doc travels), requires
every file in it to be documentation (`.md`, `.mdx`, `.txt`, `.rst`, `README*`,
`CHANGELOG*`, anything under `docs/`, `verification.md`), and commits with type `docs`.

`--commit-type` selection: `feat` for new functionality, `fix` for bug fixes, `test` for
test-only phases, `refactor` for refactoring without behavior change, `docs` for
documentation-only. `--changed-files` must NOT list the auto-staged manifests
(`package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `composer.lock`,
`poetry.lock`, `Cargo.lock`, `go.sum`) — the script appends them internally.

**The `--span-*` flags are passed ONLY when `TRACING_ON` (Step 0.5) is true**, with
`$PHASE_SPAN_ID` from 7c:

- `$PHASE_OUTCOME`: `ok` (green tests + commit), `blocked` (three-strike rule fired), `failed` (phase aborted, non-recoverable).
- `$PHASE_SUCCESS` — the correctness signal from the RED test oracle, independent of `$PHASE_OUTCOME` (`ok` means "did not crash", not "was correct first try"): `pass@1` when the tdd-cycle agent went green on its first attempt (`$AGENT_RETRIES == 0`), `pass@k` when green only after retries, `fail` when the phase never reached green.
- `$PHASE_ATTEMPTS` = `$AGENT_RETRIES + 1`. Both are absent for `docs`-mode phases, which have no test oracle.

**Output (key=value)** on success: `status=ok`, `phase=`, `service=`, `format_status=`,
`changed_by_format=`, `green_recheck=skipped|passed|not_requested`, `trivial=true|false`,
`trivial_reason=size_gate|frontmatter_override|frontmatter_override_downgraded`,
`downgrade_reason=` (only on a downgrade), `commit=<sha|(no diff)>`, `files_committed=`,
`phase_status=`, `completed_at=`, `grammar=`, `tasks_md=`, `phase_file=`, plus
`span_closed=true` when the span flags were passed.

**Store**: `PHASE_IS_TRIVIAL` (from `trivial` — 8a.3 aggregates it per service). A
docs-mode phase reports `trivial=n/a` (no diff-size gate applies); count it as
**not** trivial in 8a.3's all-phases-trivial skip.

Log: `Phase <NN> complete. Tests: <pass-count>/<total-count> passing.` and, when
`trivial=false` with `trivial_reason=frontmatter_override_downgraded`,
`Phase <NN> trivial override rejected — <downgrade_reason>.`

**Aborts** — `status=abort` plus a `reason=`, never a partial write. The phase state is
untouched on every one of them, so a retry re-enters cleanly:

| `reason` | Orchestrator action |
|----------|---------------------|
| `green_recheck_timeout` | The re-check ran past `JLU_PHASE_RECHECK_TIMEOUT_MS` (default 600 000). Nothing was committed. Treat it as a phase failure and re-dispatch `jlu-tdd-cycle` with the timeout as failure context. |
| `green_recheck_command_denied` | The `Command:` line the agent reported violates the worker-cap policy. Surface the script's stderr and re-dispatch `jlu-tdd-cycle` with it as failure context. Never relax the guard. |
| `green_broken_by_format` | The formatter moved the code off Green. The last 50 lines of the re-run are on stderr — write them to a notes file, build an `--agent=implementer --service=<service-id> --plugin-root=<PLUGIN_ROOT>` prompt per §2c, dispatch `jlu-implementer`, then retry 7e (up to 5 attempts). |
| `wrong_branch` | Abort the whole workflow. The branch invariant is load-bearing; surface to user. |
| `source_path_missing` / `not_a_git_repo` | Abort. Source path resolution is broken; surface to user. |
| `unexpected_files_in_diff` | Parse `unexpected_files=<csv>`. Treat as a phase failure and surface the file list. Do not auto-stage. |
| `non_doc_files_in_diff` | Docs mode only. Parse `non_doc_files=<csv>` and surface: the phase declared `mode: docs` but the diff contains code. Either remove the non-doc edits or change the phase's mode to `tdd`. |
| `no_doc_changes` | Docs mode only. The phase declared `mode: docs` but the working tree has no documentation changes. Make the edits or remove the phase. |
| `commit_failed` | A pre-commit hook (lint, commitlint) rejected the commit. Its last 50 lines are on stderr — write them to a notes file, build an `--agent=implementer --service=<service-id> --plugin-root=<PLUGIN_ROOT>` prompt per §2c, dispatch `jlu-implementer`, then retry 7e (up to 5 attempts). Never bypass with `--no-verify`. |
| `invalid_commit_type` / `missing_argument` | Orchestrator bug. Fix the arguments and re-run. |

A `no_changes` diff is **not** an abort: the script records `Commit: (no diff)` and
completes the phase. Log `Phase <NN> produced no diff — commit skipped.` and continue.

**Forbidden operations** (the orchestrator must NEVER invoke these, even via Bash):
`git push --force` / `git push -f`, `git reset --hard`, `git rebase` (any flavor),
`git checkout main` / `master` / `alpha`, `git branch -D`, `git commit --no-verify`.

**No container cleanup.** The TDD pipeline never starts or manages containers, so there is nothing to prune.

---

## Step 8 — Final Validation

After all phases are complete, this is the **regression check** for the entire task. It does NOT run the full test suite — Step 8b runs only the tests affected by the task's diff. The full suite is owned by the on-demand `/jlu-test-suite` skill (invoke before `/jlu-ship` when you want a richer signal) and by CI on push.

### 8a. Write Tier 2 Integration Tests (gated)

**Aggregate first**: collect every `Tier 2 Deferred` entry reported across phases. If empty, skip to Step 8b and log: `Tier 2 step skipped — no deferred requirements.`

Otherwise, for each service that has Tier 2 deferred requirements:
1. Collect every deferred requirement from that service's phase files into a notes file
   (`<TASK_DIR>/services/<service-id>/phases/final-reports/notes-test-writer.md`): one
   `- <requirement> — deferred by phase <NN>, reason: <as reported>` line each, under a
   `DEFERRED TIER 2 REQUIREMENTS` heading, preceded by the §2c `SERVICE_SOURCE_PATH`
   line when it applies.
2. Build the prompt per §2c with `--agent=test-writer --service=<service-id> --notes-file=<that file>`
   (no `--phase-file` — this is task-level) and dispatch `jlu-test-writer` with model:
   **MODEL_CONFIG.code** (default: sonnet). The script emits `TEST_TIER: 2` and the
   host-only dependency rule — an unavailable dependency is a skipped test with a
   reason, never a container the agent starts.
3. If the integration tests reveal missing wiring (e.g. a repository method needs a real
   database query that was mocked in Tier 1), dispatch `jlu-implementer` (model:
   **MODEL_CONFIG.code**, default sonnet) with a prompt built the same way —
   `--agent=implementer --service=<service-id> --plugin-root=<PLUGIN_ROOT>` and the
   failing-test output as its notes file.

### 8a.3 — Task-Level Refactor Pass (once per service)

**Opt-in gate (evaluate first, before any per-service work):** this pass runs ONLY
when the skill invocation carried `--refactor` (captured in Step 1 argument parsing,
same plumbing as `--no-autochain`) or `JLU_REFACTOR=1` is set in the env. Otherwise
log exactly `Refactor pass skipped — opt-in (--refactor)` and continue to Step 8a.5.
The `jlu-refactor-agent` and the `Refactor Candidates` report field are unchanged —
the candidates remain advisory in the persisted phase reports either way.

The Refactor step of TDD runs once per affected service against the task's full diff,
instead of once per phase: a single end-of-task pass sees every `Refactor Candidates`
entry at once, and Steps 8a.5 (build) + 8b (affected tests) verify the result with runs
that happen anyway.

For each affected service (honor `TASK_FANOUT_CAP` for cross-service fan-out; sequential when it is 1):

1. **Skip** when every one of the service's phases was classified trivial (`PHASE_IS_TRIVIAL`), or when no phase captured `refactor_candidates_present: true`. Log `Refactor pass skipped for <service-id> — no candidates reported.` and continue to the next service.
2. **Aggregate**: re-read the service's phase reports from disk and collect the union of `Files Modified` and `Refactor Candidates` across phases (include Tier 2 wiring files from Step 8a if any).
3. Dispatch `jlu-refactor-agent` (model: **MODEL_CONFIG.code**, default sonnet), wrapped in the 7b span wrapper (`--agent refactor-agent`):
   - `<PLUGIN_ROOT>` (the agent cannot derive it — see `jelou/references/plugin-root.md`)
   - Service id and service source path (worktree or repo)
   - The aggregated `Files Modified` union (its scope boundary) and `Refactor Candidates` union
   - The union of the phases' test files and the exact capped test command from the last phase report (the agent re-runs these after every refactor)
4. Handle the report:
   - `APPLIED` → commit via `finalize-phase.sh`, mirroring Step 8a.5's fix-commit call:
     ```bash
     FINALIZE_SOURCE_PATH="<SERVICE_SOURCE_PATH>" \
     FINALIZE_TASK_SLUG="<TASK_SLUG>" \
     FINALIZE_PHASE_NN="final" \
     FINALIZE_PHASE_TITLE="task-level refactor pass" \
     FINALIZE_SERVICE_ID="<service-id>" \
     FINALIZE_COMMIT_TYPE="refactor" \
     FINALIZE_EXPECTED="$(printf '%s\n' <refactor-agent Refactors Applied file 1> <file 2> ...)" \
     <plugin-root>/bin/finalize-phase.sh
     ```
     Parse the output with the same abort-reason vocabulary Step 7e routes.
   - `NO_CHANGES` → continue.
   - `BLOCKED` (two consecutive refactors went red on first try) → log the agent's last error output and continue — the remaining candidates are not load-bearing. Do not retry.

No orchestrator-level test re-run is needed — the agent re-runs after every change, and Steps 8a.5 + 8b independently validate the final state.

### 8a.5 — Build Validation (once per service)

The build runs exactly once per affected service here, against the task's full diff, instead of once per phase. The last per-phase build always subsumed the earlier ones; this catches compile errors — including any introduced by the Tier 2 wiring in Step 8a — before the affected-tests regression in Step 8b.

For each affected service (honor `TASK_FANOUT_CAP` for cross-service fan-out; sequential when it is 1):

1. Gate on compilable changes, computed inline (no scratch file — the diff feeds the classifier through an env var):
   ```bash
   cd <SERVICE_SOURCE_PATH[service-id]>
   PRE_SHA=<pre-execution commit cached in TASKS.md "Commit Tracking" for this service>
   CHANGED_FILES="$(git diff --name-only "$PRE_SHA"..HEAD)"
   CLASSIFY_FILES="$CHANGED_FILES" <plugin-root>/bin/classify-phase.sh compilable
   ```
   If `compilable=false`, log `Build skipped for <service-id> — no compilable source changed (<extensions>).` and continue to the next service.
2. Otherwise build the prompt per §2c with `--agent=build-validator --service=<service-id> --plugin-root=<PLUGIN_ROOT>` (which also carries the service source path) and dispatch `jlu-build-validator` (model: **MODEL_CONFIG.code**, default sonnet). Wrap the dispatch in the 7b span wrapper (`--agent build-validator`).
3. Handle the agent's verdict:
   - **PASS, no fixes** → continue.
   - **SKIP** (no build command detected) → continue.
   - **PASS with fixes** → commit the build fixes with `finalize-phase.sh`, using the build-validator's reported file list as scope:
     ```bash
     FINALIZE_SOURCE_PATH="<SERVICE_SOURCE_PATH>" \
     FINALIZE_TASK_SLUG="<TASK_SLUG>" \
     FINALIZE_PHASE_NN="final" \
     FINALIZE_PHASE_TITLE="resolve build errors from final validation" \
     FINALIZE_SERVICE_ID="<service-id>" \
     FINALIZE_COMMIT_TYPE="fix" \
     FINALIZE_EXPECTED="$(printf '%s\n' <build-validator Fixes Applied file 1> <file 2> ...)" \
     <plugin-root>/bin/finalize-phase.sh
     ```
     Parse the output with the same abort-reason vocabulary Step 7e routes.
   - **FAIL** (5 rounds exhausted) → pause and notify the user (Escalation Format).

### 8b. Affected-Tests Regression Check

After all phases are complete, run only the tests **related to the modified files**. This is the cheap regression net for cross-cutting changes (helpers, types, base classes) without saturating local CPU/RAM. The full suite is the developer's job to run via `/jlu-test-suite` (or CI's, on push).

The orchestrator never invokes the bare full-suite command (e.g., `npm test`) here. That responsibility was extracted from this workflow.

#### 8b.1 — Compute the affected file set

For each affected service:

```bash
cd <SERVICE_SOURCE_PATH[service-id]>
PRE_SHA=<the pre-execution commit cached in TASKS.md "Commit Tracking" for this service>
git diff --name-only "$PRE_SHA"..HEAD
```

Filter that list to source files only — drop:
- `*.md`, `*.lock`, `*.yaml`, `*.yml`, `*.json` (except `package.json`)
- Any `*.test.*`, `*.spec.*`, `__tests__/*`, `test/**`, `tests/**`
- Lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`)
- Migration files (`migrations/*`)
- Files under `dist/`, `build/`, `coverage/`, `.next/`

Call the result `CHANGED_SOURCES`.

**If `CHANGED_SOURCES` is empty**, skip Step 8b entirely. Log: `No production source changed for <service-id> — affected-tests step skipped.` Continue to Step 8c.

**If config files were the only thing that changed** (e.g., only `tsconfig.json`, `package.json`, or migration files): skip Step 8b but log: `Only config/migration files changed for <service-id> — affected-tests cannot detect related tests. Run /jlu-test-suite before opening PR.`

#### 8b.2 — Resolve the affected-tests command

The orchestrator does not detect the runner and does not assemble a command. Both are
`bin/resolve-affected-tests.mjs`, which probes the repo's real jest config
(`jest --showConfig`, ~0.3 s) so it handles presets, `projects`, TypeScript config
files, and propagates any `--config` the repo's own `scripts.test` selects:

```bash
PLAN=$(node <plugin-root>/bin/resolve-affected-tests.mjs \
  --repo="<SERVICE_SOURCE_PATH[service-id]>" \
  --changed="<CHANGED_SOURCES as a comma-separated list>" \
  --workers=<1 when TASK_FANOUT_CAP > 1, else 2>)
```

Output is `{strategy, command, reason}`, `strategy ∈ {find-related, test-glob, full-suite}`. Exit 2 is bad input (missing repo, empty `--changed`, `--workers` outside `1|2`) — an orchestrator bug, since 8b.1 already proved `CHANGED_SOURCES` non-empty.

The worker cap is **fixed** (never a configurable env var) and conditional on fan-out, expressed once as the `--workers` value above: `TASK_FANOUT_CAP = 1` → `--workers=2`; `TASK_FANOUT_CAP > 1` → `--workers=1`, because otherwise the effective worker count is `2 × cap` and the resource invariant is one test worker per concurrent lane. Affected sets are small (10–50 tests), so these caps are fast and never overload the box; more parallelism is the dev's call via `/jlu-test-suite`. Never inject `--coverage` or `--cov` — coverage belongs in CI.

**Routing by `strategy` — `full-suite` is never run:**

- `find-related` → run `PLAN.command` (jest `--findRelatedTests` with roots widened when `jest.roots` would otherwise exclude a changed source, or `vitest related`). The normal path.
- `test-glob` → run `PLAN.command` (a name-scoped `--testPathPattern`/`--testPathPatterns`; the repo declares multiple jest projects with differing roots, so one roots widening cannot express it).
- `full-suite` → **do NOT run `PLAN.command`.** Skip the service: record `AFFECTED_TESTS_RESULT[service-id] = SKIPPED` with `skip_reason = PLAN.reason`, append one `SHIP_CAVEATS` line carrying that `reason` verbatim, and log `Run /jlu-test-suite from <service-path> before /jlu-ship to confirm no regressions.`

`full-suite` is what the resolver returns when there is no haystack it can narrow — mocha, plugin-less pytest, go, an unknown runner, or a jest whose `--showConfig` would not resolve. **The orchestrator never runs a bare full suite** (8b's own doctrine; `bin/guard-test-commands.mjs` denies `npm test` outright), so that value is a routing signal, not a command to execute.

#### 8b.4 — Dispatch

1. Use the cached `TASK_FANOUT_CAP` to decide cross-service fan-out: when `> 1`, run up to that many services concurrently (each resolved with `--workers=1` per 8b.2); when `= 1`, run sequentially per service.
2. Per service whose `strategy` is not `full-suite`, run `PLAN.command` on the host runtime. Stream stdout for dev visibility.
3. **Only when `TRACING_ON` (Step 0.5) is true**, wrap each service's run in the 7b span wrapper so Step 7+8 wall-clock is measurable from the spans (when it is false, emit neither call): open with `--name affected_tests --scope task --task "$TASK_SLUG" --service "$SERVICE_ID" --phase-parallelism "$TASK_FANOUT_CAP" --parent "$WORKFLOW_SPAN_ID" --trace "$WORKFLOW_TRACE_ID"` (no `--agent`, no wave flags — this is an orchestrator Bash run, not an agent dispatch), and close with `trace-end-span.mjs` passing `--status ok` on exit 0, `--status failed` otherwise. Empty span ids under `TRACE_DISABLED=1` are tolerated as everywhere else.
4. Capture the runner's exit code as `AFFECTED_TESTS_RESULT[service-id]`.

#### 8b.5 — Handle failures

If any service's affected tests failed:
- Aggregate failing test names + file paths into a notes file.
- Build an `--agent=implementer --service=<service-id> --plugin-root=<PLUGIN_ROOT>` prompt per §2c with that notes file and dispatch `jlu-implementer` (model: **MODEL_CONFIG.code**, default sonnet). Retry up to 5 times.
- If still failing after 5 attempts: pause and notify user.

Every service the 8b.2 routing table skipped (`strategy = full-suite`) already carries its `SKIPPED` status, its `skip_reason` and its `SHIP_CAVEATS` line. `SHIP_CAVEATS` is the only surface for it — ship renders every caveat in the PR body under `### Not verified by this PR`. Log `Run /jlu-test-suite from <service-path> before /jlu-ship to confirm no regressions.` to the terminal when it happens; do not hold it for a final report.

#### 8b.6 — Record the affected-tests results

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

### 8c. Comprehensive QA (static only): RETIRED (no owner)

`execute-task` dispatches no QA agent, and `jlu-spec-reviewer` is deleted from the plugin.

**Nothing inherits the gate.** What survives existed independently of the agent:
**Affected-test execution** — Step 8b, unchanged; coverage breadth via the
deterministic `bin/probe-coverage-breadth.mjs` at ship Step 2b.6b and in `/jlu-goal`
Phase 4.5 (the unconditional whole-task FAIL on a validated field with no rejecting
test is gone); the Testcontainers/Docker tier ban, now self-enforced by the agents that
author tests; and **The no-comments rule**, inherited from
`jelou/references/subagent-base.md` — No agent re-reads the diff to catch a
comment that slipped through.

Unenforced from here on, with no replacement anywhere in the pipeline: code-smell and
over-engineering review, security review of new endpoints, N+1 and unbounded query
review, repository-convention compliance, cross-service contract matching, the spec-quote audit
of test rewrites, the tdd-cycle's own objection/deviation flags, the 100-line function
cap, and artifact completeness.

`SHIP_CAVEATS` is unaffected as a mechanism — Steps 8e and 8g still append to it, and
ship still renders it under `### Not verified by this PR`; it simply receives no
QA-derived rows. Continue to Step 8d.

### 8d. Post-Validation Cleanup

No cleanup needed. The TDD pipeline never starts containers, so there is nothing to prune. If a dev container is running for `/jlu-start-dev`, leave it alone — its lifecycle is owned by that workflow.

### Step 8e — Materialize the UI E2E suite from SPEC.md (shift-left)

After backend validation passes, author the UI E2E suite for any affected frontend
service so it ships with the change.

**The UI/backend split is not restated here.** It is `bin/classify-task-scope.mjs` —
the same classifier `/jlu-goal` uses, which already implements this rule (frontend
stacks `react`/`nextjs`/`vue`/`angular`/`svelte`, with the `description` regex as the
legacy fallback for registrations that carry no `stack`):

```bash
SCOPE=$(node <plugin-root>/bin/classify-task-scope.mjs \
  '[{"id":"<service-id>","stack":"<services.yaml stack>","description":"<services.yaml description>"}, ...]')
```

It returns `{scope, ui_services, backend_services, warnings}`. Iterate
`SCOPE.ui_services`; `scope = full-backend` (empty `ui_services`) makes this whole step
a no-op. Log every `SCOPE.warnings` entry as a one-line WARN — each names a service
detected as UI by `description` alone, whose `services.yaml` entry should declare a
`stack`. Exit 1 means empty or invalid input, an orchestrator bug: `AFFECTED_SERVICES`
cannot be empty at Step 8e.

For each id in `SCOPE.ui_services`:

1. Look its worktree up in `SERVICE_SOURCE_PATH` (Step 6 already resolved it, mode-driven, per `jelou/references/worktree-resolution.md`).
2. Pick the writer's `MODE`. `jlu-ui-e2e-writer` has three, and each one has a branch
   here — a service that already has a `user-flow.md` but no specs still needs a
   dispatch, and that is the `normal` mode:

   | Worktree / task-dir state | MODE |
   |---------------------------|------|
   | No Playwright infra in the worktree (no `playwright.config.{ts,js}`) | `bootstrap` — scaffolds the infra, then falls through to `derive-from-spec` itself |
   | Infra exists, `<TASK_DIR>/services/<UI_SERVICE_ID>/user-flow.md` does not | `derive-from-spec` — the writer generates `user-flow.md` from `SPEC.md`, then authors the suite |
   | `user-flow.md` exists, `<TASK_DIR>/services/<UI_SERVICE_ID>/e2e/` holds no `*.spec.ts` | `normal` — the writer authors the suite from the existing `user-flow.md` |
   | Both `user-flow.md` and generated specs exist | no dispatch. Log `UI E2E suite already present for <UI_SERVICE_ID> — skipping.` |

3. Dispatch `jlu-ui-e2e-writer` with that `MODE`, `EXPECT=red`, `<TASK_DIR>`,
   `<UI_SERVICE_ID>` and `<UI_SERVICE_WORKTREE>`. The writer emits `user-flow.md` (in
   the two deriving modes) plus the complete suite — success + non-default-field +
   reference-population + negative/rejection, per its rule 4b.

   **`bootstrap` is dispatched without asking.** This workflow is fully autonomous and
   Step 8g settles the same question one section below — *never by asking the user
   mid-chain*. Where the writer's own doc mentions a confirmation, **take the
   documented default**: scaffold, and append one `SHIP_CAVEATS` line naming the
   service whose Playwright config and fixtures are generated rather than reviewed.
   A `BLOCKED` report (scaffold or install failed) is not a retry and not a prompt:
   append its verbatim manual command as a second caveat and continue to Step 9.

4. Commit the generated `user-flow.md` + specs to the task branch — through Step 8g,
   which decides what an ignored suite path means.

This step authors only — it is **pre-deploy**: it does NOT boot a UI server and does
NOT run Playwright. Running the suite is `/jlu-goal`'s job (Phase 4, via
`jlu-ui-qa-runner`). It is a no-op when no UI service is affected.

### Step 8f — Backend E2E authoring: RETIRED (owned by `/jlu-goal` Phase 3.5)

`execute-task` no longer dispatches `jlu-test-writer` for backend E2E and no longer
authors `test/e2e/**` or `*.e2e-spec.ts`. `/jlu-goal` Phase 3.5 owns it, treats a
missing suite as **mandatory, not discretionary** authoring, and is the only stage that
can prove it green.

The trade this makes explicit: a PR opened without ever running `/jlu-goal` does not
carry a backend E2E suite. Frontend parity is unaffected — **Step 8e (UI E2E) stays**,
because a UI change has no other authoring path before ship.

### Step 8g — Ignored suite path (applies to 8e)

A generated suite whose path is excluded by git cannot travel with the PR, and
silently leaving it uncommitted is worse than either alternative. Decide it
here — never at ship time, never by asking the user mid-chain:

1. Before committing, classify the path. The orchestrator does not interpret
   `git check-ignore` output itself:
   ```bash
   IGNORED=$(node <plugin-root>/bin/classify-ignored-suite.mjs \
     --path="<suite-path>" --repo="<the service worktree resolved in 8e step 1>")
   ```
   Output is `{status, rule, source, action, caveat}`.
2. Switch on `.action` — these three branches are exhaustive:

   | `.status` / `.action` | Do |
   |------------------------|----|
   | `not_ignored` / `commit` | Commit the suite normally. Nothing to record — `.caveat` is `null`. |
   | `local_rule` / `force_add` | The exclusion is a **local, uncommitted** rule (`.git/info/exclude`, or a `.gitignore` that is itself untracked) — one developer's local choice, which must not decide what a PR contains. `git add -f <suite-path>`, commit, and append `.caveat` to `SHIP_CAVEATS` verbatim. |
   | `repo_rule` / `leave_uncommitted` | The exclusion is a **committed repo rule** (the matching `.gitignore` is tracked) — the repo's deliberate convention. Do not fight it, do not force-add. Leave the suite uncommitted and append `.caveat` to `SHIP_CAVEATS` verbatim; it already names the path, the rule, and the `<file>:<line>` it came from. |

3. **Exit 3 is a git failure**, not a fourth classification: `git` could not run, the
   path lies outside the repo, or `check-ignore` output was unparseable. Never read it
   as `not_ignored`. Leave the suite uncommitted, append one `SHIP_CAVEATS` line
   naming the suite path and the script's stderr verbatim, and continue. (Exit 2 is
   bad input — a missing `--path`/`--repo` or a repo path that is not a directory —
   an orchestrator bug; fix the arguments.)

Every branch continues to Step 9. An ignored suite path is a disclosure, not a
stop, and never a question.

---

## Step 9 — Success Path

If all validation passes:

1. Update TASKS.md:
   - Status: `validating` → `ready_to_publish`
   - Add completion timestamp
   - Record final test counts
2. **Print nothing here when the chain is on.** The final output of this workflow is
   the PR list at 9.5e and nothing else.

   Resolve the autochain flag NOW (§2 of
   `{plugin-root}/jelou/references/autochain-handoff.md`; Step 9.5 reuses this
   same resolved value):

   - **Chain on** (`true`) → print **NOTHING** and fall through to Step 9.5, which
     owns the entire final output. Do not print a status line, a phases table, or
     a `/jlu-ship` line: that line is the manual fallback, and printing it while
     the chain is on is what turns an autonomous run into a question the user has
     to answer.
   - **Chain off** → no PR will exist, so print exactly these two lines and stop:

     ```
     ## <TASK_SLUG>

     - Run /jlu-ship to open the pull request.
     ```

---

## Step 9.5 — Auto-chain (ship → PRs green)

Runs ONLY from the Step 9 success path — that IS the green-gate: every phase
done and final validation green (Step 8c QA is retired — see it). A red gate
lands in Step 10 instead, so a PR is only ever opened on a green gate.

**Resolve the flag** per §2 of
`{plugin-root}/jelou/references/autochain-handoff.md` (precedence:
`--no-autochain` argument > `JLU_AUTOCHAIN` env >
`node {plugin-root}/bin/jlu-settings.mjs get autochain`). If the resolved
value is not `true`, stop here — Step 9's two-line chain-off block stands.

**Resolved `true` is the user's standing authorization to ship.** It covers
the outward-facing act — pushing branches, opening PRs — for this entire
chain, and it was configured precisely so nobody has to type `/jlu-ship`.
**Never ask the user to confirm shipping**, and never substitute a
recommendation for the dispatch: printing *"Want me to run `/jlu-ship`
now?"* while the flag is `true` is the exact gate this step exists to remove.
"Unattended" is the configured mode here, not a risk to escalate.

The stops available to you are the closed list in §5 of the recipe — a red
green-gate, or one of ship's own named `question` gates. Everything else
continues:

- A QA follow-up (`FU-*`), a manual or human smoke test you cannot perform, or a
  verification that is inherently post-merge is **not** a stop. It is already in
  `SHIP_CAVEATS`.
- A condition the workflows do not name is **not** a stop. Take the
  documented default, append one line to `SHIP_CAVEATS`, continue.
- "Opening this PR would overstate what was verified" is **not** a stop — it
  is exactly what `SHIP_CAVEATS` publishes. 9.5b hands it to ship, ship's
  Step 7d renders it in the PR body under `### Not verified by this PR`, and
  the reviewer sees precisely what was and was not covered.

**9.5a — ClickUp bind (only when an inline reference was given).** If the
invocation carried a ClickUp task URL or id and `<TASK_DIR>/CLICKUP_TASK.json`
does not exist, seed it with `{ "task_id": "<id>" }` (extract the id from URL
forms like `https://app.clickup.com/t/<id>`). Non-blocking: any failure is a
WARN, never a stop. (Task creation itself happens at SPEC approval in
new-task/refine-task; this step only binds a pre-existing task handed in
late.)

**9.5b — Ship inline.** Ship opens its own trace span into the same
`WORKFLOW_SPAN_ID` variable this workflow uses — snapshot first
(`EXEC_SPAN_ID=$WORKFLOW_SPAN_ID; EXEC_TRACE_ID=$WORKFLOW_TRACE_ID`), then
read `{plugin-root}/jelou/workflows/ship.md` and follow it in this session
with argument `<TASK_SLUG>` — the same inline read-and-follow mechanism this
workflow itself uses — and restore the snapshot after ship's own span close
(`WORKFLOW_SPAN_ID=$EXEC_SPAN_ID; WORKFLOW_TRACE_ID=$EXEC_TRACE_ID`).
Without the snapshot, ship's span close consumes this workflow's span and the
final Step N double-closes ship's.

Hand ship two inputs: the `SHIP_CAVEATS` list accumulated in Steps 8e/8g
(it renders in every PR body at Step 7d) and **`<AUTONOMOUS> = yes`**. That
second one is what carries the authorization into ship's own gates: none of them
asks, each takes its documented default and records a caveat, per ship.md's
"Autonomous mode — how every gate resolves". The chain does not stop at a
preflight FAIL, a compliance gap, a CLOSED PR or a rate limit — it decides,
discloses in the PR, and moves on. Only two outcomes end work: a task status of
`draft`/`refining` aborts the run (no agreed contract to ship against), and a
service whose build or git push could not succeed comes back `blocked` with no
PR. Ship's gate list is closed — never invent an extra confirmation here.

**The PR set** is defined from ship's Step 11 result rows: every PR with
`Action ∈ {created, existing}` AND `State = OPEN`. Rows with
`Action ∈ {skipped, n/a}` (nothing to ship, services without an
`alpha` branch) are out of scope and listed as such in the 9.5e table; a
`State = MERGED` PR is trivially green — count it GREEN without dispatching
a runner (resolve-pr has no merged-PR guard for explicit URLs and would push
fix commits onto a merged branch). Persist the set NOW to
`<TASK_DIR>/AUTOCHAIN.json` (`{ "prs": [{ "url", "service", "kind":
"production|staging", "verdict": "pending" }] }`) — this file is the chain's
re-entry point.

**Blocked services.** A row with `Action = blocked` had a PR to open and could
not. Record each in `AUTOCHAIN.json` as
`{ "service", "kind", "verdict": "BLOCKED", "reason" }` with no `url`, and do
NOT dispatch a resolve-pr runner — there is no PR to drive. These are what
separate a partial ship from a green one at 9.5e; never fold them into
`skipped`.

**9.5c — Drive every PR to green.** Dispatch the `jlu-resolve-pr-runner`
agent via `task` — **in parallel across services, at most 3 runners at a
time** (one dispatch message carries up to 3; the next batch goes out as
verdicts return — never raise the cap). Per-service order stays strict: the
**production PR first, then that service's staging PR** — the staging runner
needs the production runner's `fixShas`, so a service's staging dispatch
waits for its production verdict while other services' runners keep running.
Inputs per dispatch:

- `<PR_URL>` — the PR.
- `<SERVICE_CWD>` — ship's mode-aware resolution for that service
  (Mode: worktree → `<service-repo>/.worktrees/<TASK_SLUG>`; Mode: branch →
  the service repo root on `production/<TASK_SLUG>`).
- `<PLUGIN_ROOT>`.
- `<SPEC_PATH>` — `<TASK_DIR>/SPEC.md`; the runner hands it to the workflow's
  Step 6 scope guard so suggestions that reach outside the spec's scope
  escalate instead of applying.
- `<EPHEMERAL_BRANCH>` — set to `staging/<TASK_SLUG>` for staging PRs (their
  temp worktree was torn down after push; the runner recreates and removes
  one).
- `<CHERRY_PICK_SHAS>` — staging PRs only: the fix-commit SHAs the
  production runner pushed (empty when it pushed none). Ship's staging model
  is `origin/alpha` + cherry-picks of production; the staging runner applies
  code fixes ONLY by cherry-picking these SHAs — independent staging-side
  fix commits would collide with the next ship's incremental cherry-pick
  sync.

Parallel dispatch is safe under the resource-caps policy: a runner's
wall-clock is dominated by network waits — the review-arrival gate and the
CI watch — and its local work is capped by subagent-base's worker policy
(single test file, `--runInBand`/`--maxWorkers=2`), so 3 concurrent runners
stay far below the uncapped full-suite profile that froze the machine.

After EVERY dispatch returns (any verdict, including a killed/aborted
runner): update that PR's `verdict` in `<TASK_DIR>/AUTOCHAIN.json` — and for
production PRs also record the runner's pushed fix-commit SHAs as
`"fixShas"` on that entry, so a resumed session can hand `<CHERRY_PICK_SHAS>`
to a still-pending staging runner — and run the **worktree backstop**: if
the runner's ephemeral worktree
(`<service-repo>/.worktrees/<TASK_SLUG>-resolve-tmp`) still exists,
`git -C <service-repo> worktree remove --force` it; a leftover keeps
`staging/<TASK_SLUG>` checked out and poisons the next ship's
`worktree add`.

**Task-green = AND of every runner verdict being `GREEN`, AND no service
`blocked` at ship.** A `NOT_GREEN` or `BLOCKED` verdict does not abort the
remaining runners — every PR gets its run; the aggregate is computed at the
end. A service that ship blocked has no PR and therefore no runner, so it can
never contribute a `GREEN`: it makes task-green NO on its own. Without that
second clause a build-failed service would silently report task-green YES
while its code never shipped.

**Re-entry.** If `<TASK_DIR>/AUTOCHAIN.json` already exists when Step 9.5
begins (a prior chain died mid-run — context exhaustion, abort), skip 9.5b:
re-enter here and dispatch runners only for PRs whose `verdict` is not
`GREEN`, then continue to 9.5d.

**9.5d — ClickUp status flip (non-blocking).** Once the aggregate is known,
update the bound ClickUp task inline with the session-level ClickUp MCP tools
(`jlu-pm-agent` is DEPRECATED — it has no MCP access and must not be
dispatched): green → set the internal state `ready_to_publish` and move the
ClickUp status to `PENDING TO PRODUCTION`; not green → leave the status
unchanged and add a comment listing the escalations. Any ClickUp failure is a
WARN, never a stop, and the chain result never depends on it. Skip silently
when `CLICKUP_TASK.json` does not exist.

**9.5e — Final report.** This is the workflow's ONLY output on the chain-on path
(Step 9 prints nothing). It is the PR list, and — conditionally — the two things
that cannot be recovered from a URL. Print:

```
## <TASK_SLUG>

- <pr-url> · <service-id> · <GREEN | NOT_GREEN>
- <pr-url> · <service-id> (staging) · <GREEN | NOT_GREEN>
- — · <service-id> · BLOCKED (<reason>)
```

One bullet per PR, in ship's row order; a service ship blocked has no URL, so its
bullet opens with `—` and carries `BLOCKED (<reason>)`. Rows with
`Action ∈ {skipped, n/a}` get no bullet at all — nothing was shipped for them.
Print no heading other than the task slug, no task-green line (it is the AND of
the bullets and visible in them), no cycles column, and no `### Next Steps`.

**Conditional sections — print each ONLY when it has content, and print nothing
at all when it does not (no "none" line, no empty heading):**

- **Escalations.** When at least one runner escalated, or at least one service is
  `BLOCKED`, print an `### Escalations` section with one line each, keeping the
  runner's signal **verbatim** and its `resume:` command:

  ```
  ### Escalations
  - <signal> — <one line> — resume: /jlu-resolve-pr <pr-url>
  - <service-id> blocked at ship: <reason> — resume: fix, then /jlu-execute-task <task-slug>
  ```

  Zero escalations and zero blocked services → the section does not appear.

- **Autonomous gate decisions (SHIP_CAVEATS).** Same rule: print
  `### Autonomous gate decisions (from SHIP_CAVEATS)` with one line per decision
  only when a gate actually fired. No gate fired → nothing is printed. The caveats
  are already rendered in each PR body under `### Not verified by this PR`; this
  section is the terminal echo, not their storage.

- **ClickUp.** Print a `ClickUp: WARN <reason>` line only on a WARN or failure at
  9.5d. On success, and when `CLICKUP_TASK.json` does not exist, print nothing —
  a silent success needs no line.

Fire one OS notification (best-effort, never blocking) summarizing the
aggregate:

```bash
node -e "
import('{plugin-root}/bin/lib/dev-orchestrator/notify.mjs').then((m) =>
  m.notifyOs({ title: 'jlu-execute-task', body: process.argv[1] })
);
" "<TASK_SLUG>: task-green=<YES|NO>, <N> escalation(s)"
```

`$WORKFLOW_OUTCOME` for the span close: `ok` when task-green, `blocked`
otherwise (any `NOT_GREEN` or `BLOCKED` verdict — a `BLOCKED` runner may
legitimately report zero escalations, and it is still not green).

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

2. Auto-retry each failed phase (re-run the full TDD cycle from Step 7c). Track attempts per phase.

3. If a phase fails after 5 total attempts: pause and notify user (see Escalation Format below).

4. Update TASKS.md with the failure state and details.

---

## Error Handling

| Error | Action |
|-------|--------|
| Task not in `planned` or `implementing` state | Stop with status message |
| SPEC.md missing | Stop — cannot execute without spec |
| Codebase files missing | Warn, proceed (agents will have less context) |
| TDD cycle agent fails | Kill, spawn fresh with failure context — up to 5 attempts |
| Tests never go green after 5 retries | Pause and notify user (see Escalation Format) |
| Formatting breaks Green (`green_broken_by_format`) | Dispatch `jlu-implementer` (prompt per §2c, `--plugin-root=<PLUGIN_ROOT>`) with the re-run output, retry 7e — up to 5 attempts |
| Phase commit rejected by a hook (`commit_failed`) | Dispatch `jlu-implementer` (prompt per §2c, `--plugin-root=<PLUGIN_ROOT>`) with the hook output, retry 7e — up to 5 attempts |
| Build validation fails after 5 rounds | Pause and notify user (see Escalation Format) |
| Worktree missing | Fall back to main repo, warn user |
| Destructive SQL in Bash command | Block execution, report BLOCKED (SQL Safety Gate) |

---

## Escalation Format

When any retry limit (5 attempts) is exhausted, this is the **only** point where execution pauses for user input. Use `question` with this format:

```
## Execution Paused — Manual Intervention Needed

Phase <NN>: <Phase Name> (<service-id>)
Failure type: <tdd-cycle | build | commit>
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

## Step N — Close workflow span

**Guard: skip this entire step when `TRACING_ON` (Step 0.5) is false.** No span was
opened, so there is nothing to close and no Bash call to emit. `$WORKFLOW_OUTCOME`
is still determined — Step 9.5e references it — it just is not published anywhere.

Determine `$WORKFLOW_OUTCOME`:
- `ok` — all phases done, final validation green, ready for `/jlu-ship` (or, when the
  Step 9.5 auto-chain ran: shipped AND task-green)
- `blocked` — workflow halted on a phase escalation; user intervention required
- `failed` — workflow aborted (irrecoverable error)

Run:
```bash
node "<root>/bin/trace-end-span.mjs" \
  --span "$WORKFLOW_SPAN_ID" --status "$WORKFLOW_OUTCOME"
```

Empty `$WORKFLOW_SPAN_ID` (when `TRACE_DISABLED=1`) is tolerated. This is the last step.
