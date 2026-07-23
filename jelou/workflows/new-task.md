# Workflow: new-task

> Orchestrator workflow for `/jlu-new-task [task description]`
> Creates a new task, runs the spec interview inline, and creates worktrees in the background.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

---

## Principles

> **Precision over speed. Ask before assuming. The spec is the contract.**

- A vague spec produces vague code. Invest in clarity now to avoid rewrites later.
- Every question should be informed by what you found in the codebase, not generic.
- The user's time is valuable — ask 3-6 focused questions per round, not 10 scattered ones.
- When the user says "that's enough", stop. Write the spec with what you have.
- The spec is complete when a developer could implement it without guessing.

**When to simplify:** For obvious, well-bounded tasks (single endpoint, single fix, clear requirements), the interview can be as short as 1-2 rounds. Don't force 8 rounds of questions on a task that's already clear.

## Performance Guardrails (mandatory)

- Read this workflow file once per run. Do not re-read it unless the file changed during execution.
- Batch independent filesystem/tool reads in a single parallel tool-call message whenever possible.
- If `.spec-workspace.json` exists and resolves correctly, do not run recursive workspace discovery globs.
- For large scans under `<WORKSPACE_PATH>/specs/`, always do a 2-pass strategy: (1) cheap file shortlist, (2) targeted reads on shortlist only.
- For `TASKS.md` metadata extraction (status/services), read only the top section first (max 40 lines) and expand only if required.
- Keep pre-interview source drilldown bounded: max 3 focused grep queries + max 3 source file reads unless unresolved ambiguity remains.
- Minimize question latency: ask with recommended defaults when available; only branch into follow-up prompts if user picks custom input.

---

## Step 0 — Open workflow span

> **Tracing tolerance**: When `TRACE_DISABLED=1`, the captured ids are empty strings — the workflow continues regardless.

Run:
```bash
WF_OUT=$(node "${PLUGIN_ROOT:-.}/bin/trace-start-span.mjs" \
  --name new_task --scope task)
WORKFLOW_SPAN_ID=$(echo "$WF_OUT" | jq -r '.span_id // ""')
WORKFLOW_TRACE_ID=$(echo "$WF_OUT" | jq -r '.trace_id // ""')
```

Note: `--task` is omitted at this step because the slug is created later in this workflow. The trace_id binds the workflow to the eventual task once the slug exists.

---

## Step 1 — Resolve Workspace

1. Read `.spec-workspace.json` from the current working directory.
   - If it exists:
      a. Extract `workspace` path and `serviceId`.
      b. Resolve `workspace` relative to the current directory.
      c. Verify the `.spec-workspace/` directory exists at that path.
      c1. If this succeeds, skip any additional workspace discovery globs/searches.
      d. If the directory does NOT exist at the configured path:
         - Search parent directories (up to 5 levels) for `.spec-workspace/`.
         - If found elsewhere, offer to update `.spec-workspace.json` to the correct path.
         - If not found anywhere, offer to create it (see step 1.2).
   - If `.spec-workspace.json` does NOT exist:
     a. Search parent directories (up to 5 levels) for `.spec-workspace/`.
     b. If found: offer to create `.spec-workspace.json` in the current directory pointing to it.
     c. If NOT found: offer to create the workspace:
        - Create `../.spec-workspace/` with base structure:
          ```
          ../.spec-workspace/
            registry/
              services.yaml
            principles/
              ENGINEERING_PRINCIPLES.md
            services/
            specs/
          ```
        - Initialize `services.yaml` with empty services list.
        - Initialize `ENGINEERING_PRINCIPLES.md` with default principles template (security, simplicity, readability, TDD, repo conventions).
        - Create `.spec-workspace.json` in the current directory.

**Store**: `WORKSPACE_PATH`, `SERVICE_ID`

---

### 1b. Resolve Model Configuration

1. Read `.spec-workspace.json` from the current directory (already read in Step 1).
2. If a `models` section exists, extract the model overrides.
3. Store as `MODEL_CONFIG`.
4. Use `MODEL_CONFIG.operational` (default: haiku) for the git-agent spawn in Step 15c.

---

## Step 2 — Verify Service Registration

1. Read `<WORKSPACE_PATH>/registry/services.yaml`.
2. Check if `SERVICE_ID` is registered in the services list.
3. If NOT registered:
   - Ask the user: "Service `<SERVICE_ID>` is not registered in `services.yaml`. Register it now?"
   - If yes:
     a. Auto-detect the stack by examining the current directory (look for `package.json`, `composer.json`, `go.mod`, `Cargo.toml`, framework-specific files like `nest-cli.json`, `artisan`, `next.config.*`, `angular.json`, `vite.config.*`).
     b. Confirm detected stack with user.
     c. Add entry to `services.yaml`:
        ```yaml
        - id: <SERVICE_ID>
          path: <relative-path-from-workspace>
          stack: <detected-stack>
        ```
   - If no: warn that some features may not work correctly without registration.

### 2b. Docker Detection

After service registration (or if already registered):

1. Search the service repo for `docker-compose.yml`, `docker-compose.yaml`, or `compose.yml`.
2. If a Compose file is found and the service does NOT already have a `docker` block in `services.yaml`:
   - Ask: "Docker Compose file detected at `<path>`. Register Docker config for this service?"
   - If yes:
     a. Parse the Compose file's `services:` keys and suggest the service name.
     b. Ask for the port env var name (default: `APP_PORT`).
     c. Write the `docker` block into the service's entry in `services.yaml`:
        ```yaml
        docker:
          service: <compose-service-name>
          compose_file: <relative-path>
          port_env: <port-env-var>
        ```
   - If no: skip, proceed as non-Docker service.
3. If no Compose file is found: skip silently.

---

### 2c. Template Auto-Detection

1. Check if `<WORKSPACE_PATH>/templates/` directory exists.
   - If not, create it and copy built-in templates from `<PLUGIN_ROOT>/jelou/templates/spec-templates/` to `<WORKSPACE_PATH>/templates/`.
2. Scan `<WORKSPACE_PATH>/templates/` for `.md` files.
3. Build an initial candidate list using filename+keyword heuristics **without reading all templates**:
   - API/endpoint/route/request/response keywords -> shortlist `rest-api.md`
   - UI/component/frontend/screen/form/modal keywords -> shortlist `ui-component.md`
   - Database/migration/schema/table/column keywords -> shortlist `db-migration.md`
   - Event/consumer/async/queue/message/subscriber keywords -> shortlist `event-consumer.md`
4. If the shortlist is non-empty, read only shortlisted template files.
5. If the shortlist is empty, then (fallback) read each template's `## Description` section and do semantic matching.
6. Analyze the task description (`TASK_DESCRIPTION`) against chosen template descriptions and interview hints.
   Determine which templates are relevant based on keyword and semantic matching:
   - API/endpoint/route/request/response keywords → rest-api template
   - UI/component/frontend/screen/form/modal keywords → ui-component template
   - Database/migration/schema/table/column keywords → db-migration template
   - Event/consumer/async/queue/message/subscriber keywords → event-consumer template
   - Custom templates: match against their `## Description` content
7. If one or more templates match:
   a. Read each matching template file.
   b. Merge `## Pre-filled Sections` from all matching templates:
      - Combine Functional Requirements lists (re-number sequentially: FR-1, FR-2, ...)
      - Combine Non-Functional Requirements lists (re-number sequentially: NFR-1, NFR-2, ...)
      - Merge Constraints (deduplicate overlapping constraints)
      - Merge Success Criteria (re-number sequentially: SC-1, SC-2, ...)
      - For Problem Statement: keep one `<!-- FILL -->` placeholder
      - For Out of Scope: keep one `<!-- FILL -->` placeholder
   c. Merge `## Interview Hints` from all matching templates into a combined list (deduplicate overlapping hints).
   d. Set `DETECTED_TEMPLATES` = list of template names,
      `MERGED_PREFILL` = merged pre-filled sections,
      `MERGED_HINTS` = combined interview hints.
8. If no templates match:
   a. Set `DETECTED_TEMPLATES` = empty, `MERGED_PREFILL` = empty, `MERGED_HINTS` = empty.
9. Log detected templates to terminal:
   "Auto-detected templates: <template-1>, <template-2>" or
   "No domain-specific templates matched. Using generic interview."

**Store**: `DETECTED_TEMPLATES`, `MERGED_PREFILL`, `MERGED_HINTS`

---

## Step 3 — Prompt for Task Details

1. **Task description**:
   - **Council seed detection (run first).** A `/jlu-council` session that reached consensus
     writes a self-sufficient seed at
     `<WORKSPACE_PATH>/.spec-workspace/council/<slug>/new-task-seed.md` (or, with no workspace,
     `<cwd>/council-runs/<slug>/new-task-seed.md`). This is the council's fresh-window handoff:
     the full task context lives on disk so it can be reloaded into a clean session.
     a. If the command argument names or points at a `new-task-seed.md` path, read that file directly.
     b. Otherwise glob both council roots — `<WORKSPACE_PATH>/.spec-workspace/council/*/new-task-seed.md`
        and `<cwd>/council-runs/*/new-task-seed.md` — for seeds NOT yet consumed (no sibling
        `new-task-seed.consumed.md`). `<WORKSPACE_PATH>` is the `workspace` field resolved in Step 1, so
        this matches exactly where `/jlu-council` writes. 2-pass: shortlist filenames, read only the chosen one.
     c. If one or more pending seeds exist and none was passed explicitly, ask via `question`
        (most recent first, labelled by idea + timestamp) whether to seed from the council outcome
        or start fresh.
   - **When a council seed is selected:** read it; set `TASK_DESCRIPTION` from its refined idea;
     fold its accepted conditions, surviving trade-offs and in-scope services into the interview
     prefill/hints so the interview is short and grounded; keep its `COUNCIL_REPORT.md` pointer for
     reference; then mark the seed consumed by renaming it to `new-task-seed.consumed.md` so it is
     never re-offered.
   - Else if provided as the command argument, use it as the seed — after
     stripping the chain tokens per autochain-handoff.md §1: a ClickUp URL/id
     and `--no-autochain` are captured for the handoff step, never treated as
     part of the task description.
   - Else, ask the user:
     > "Describe the task you want to create:"
2. **Sprint number**:
   - Infer a recommended sprint from the latest `- Sprint:` value found in existing `TASKS.md` files under `<WORKSPACE_PATH>/specs/`.
   - Ask once with options:
     - `Use <recommended-sprint>` (recommended)
     - `Custom sprint`
   - If user picks `Custom sprint`, ask for numeric value and validate (> 0).
   - If no prior sprint exists, use `1` as recommended.
3. **Creation date**:
   - Auto-generate today's date in `dd-mm-yyyy` format using the system's local timezone.
   - Do NOT prompt the user.

**Store**: `TASK_DESCRIPTION`, `SPRINT_NUMBER`, `CREATION_DATE`

---

## Step 4 — Generate Task Slug

1. Derive a concise English action phrase from the task description, regardless of the language used by the user:
   - Translate semantic words to English before slugification. Do not merely remove accents or transliterate the original wording.
   - Keep technical identifiers, product names, acronyms, and version numbers unchanged.
   - Prefer conventional software-engineering verbs such as `add`, `update`, `upgrade`, `fix`, `remove`, or `migrate`.
   - The slug must contain English semantic words only. If a translation is ambiguous, choose the shortest conventional software term that preserves the user's intent.
   - Do not translate or rewrite `TASK_DESCRIPTION` or the human-facing SPEC content; this rule applies only to `TASK_SLUG`.
   - Example: `Actualizar Fastify Middie para NestJS 11` becomes `update-fastify-middie-nestjs-11`, never `actualizar-fastify-middie-nestjs-11`.
2. Convert the English action phrase into the slug:
   - Convert to lowercase.
   - Replace spaces and special characters with hyphens.
   - Remove consecutive hyphens.
   - Truncate to a maximum of 50 characters.
   - Remove trailing hyphens.
3. Verify the slug does not already exist at `<WORKSPACE_PATH>/specs/<CREATION_DATE>/<task-slug>/`.
   - If it already exists, append a numeric suffix (e.g., `-2`, `-3`).

**Store**: `TASK_SLUG`

---

## Step 5 — Create Task Directory

1. Create the task directory tree:
   ```
   <WORKSPACE_PATH>/specs/<CREATION_DATE>/<TASK_SLUG>/
     services/
   ```

**Store**: `TASK_DIR` = `<WORKSPACE_PATH>/specs/<CREATION_DATE>/<TASK_SLUG>`

---

## Step 6 — Write Initial TASKS.md

Write the initial tracker to `<TASK_DIR>/TASKS.md`:

```markdown
# Task: <TASK_SLUG>

## Status: refining

## Lifecycle
- Created: <current-datetime-ISO>
- Sprint: <SPRINT_NUMBER>

## Services
- Primary: <SERVICE_ID>
- Affected: (pending detection)

## Phases
(pending — will be generated by /jlu-execute-task)

## Testing
(pending)

## External Links
- ClickUp: (not synced)
- PR: (not created)
```

If a tasks.md template exists at `<plugin-root>/jelou/templates/tasks.md`, use it as the base. Otherwise, use the format above.

Note: The `## Branching` section is NOT written here. It is appended to TASKS.md in Step 8c after `DUAL_PR` is known.

---

## Step 7 — Detect Affected Services

1. Read `<WORKSPACE_PATH>/registry/services.yaml` for all registered services.
2. Read `<WORKSPACE_PATH>/services/<SERVICE_ID>/codebase/INTEGRATIONS.md` (if it exists) to understand the primary service's integration points.
3. Analyze the task description (`TASK_DESCRIPTION`) for references to other services:
   - Look for service names or IDs mentioned in the text.
   - Cross-reference with known integrations from INTEGRATIONS.md.
   - Cross-reference with services registered in `services.yaml`.
4. Build a proposed list of affected services (always including the primary `SERVICE_ID`).
5. Check for references to services NOT in the registry (Decision #39):
   - If found, warn: "The task references `<name>` which is not registered in `services.yaml`. Would you like to register it?"

**Store**: `PROPOSED_SERVICES` = list of affected service IDs

---

## Step 8 — Confirm Affected Services

Present the proposed affected services to the user:

```
Affected services for this task:
  1. <SERVICE_ID> (primary)
  2. <service-2>
  3. <service-3>

Confirm? (yes / add more / remove some)
```

- If the user confirms: proceed with the list.
- If the user wants to add/remove: update the list and confirm again.

**Store**: `CONFIRMED_SERVICES` = final list of affected service IDs

Create the per-service directories in the task folder:
```
<TASK_DIR>/services/<service-id>/
  phases/
  uh/
```

Update `TASKS.md` with the confirmed affected services list.

---

### 8b. Conflict Detection

After confirming affected services, scan for overlapping active tasks:

1. **Build candidate set quickly (2-pass):**
   a. Glob `specs/*/*/TASKS.md` once.
   b. Exclude files whose status is clearly terminal (`closed`, `cancelled`, `rolled_back`) using grep/metadata extraction.
   c. From non-terminal files, shortlist only those mentioning any service in `CONFIRMED_SERVICES` on `- Primary:` or `- Affected:` lines.
   d. Exclude the current task being created.

2. **Read candidate metadata only:**
   - For each shortlisted file, read top section first (max 40 lines) to extract status + services.
   - Only if services cannot be determined from `TASKS.md`, then read `SPEC.md` first heading/intro as fallback.

3. **Detect overlaps**:
   For each active task, compare its affected services with `CONFIRMED_SERVICES`.
   If any service-id appears in both lists, record the overlap:
   - Active task slug
   - Active task status (e.g., "implementing, Phase 3/5")
   - Overlapping service IDs
   - Active task's spec title (from SPEC.md first line, if readable)

4. **Report conflicts**:
   If overlaps were found, present via question:
   ```
   Conflict detected with active task(s):

   Task: <active-task-slug> (<status>)
     Title: <spec title>
     Overlapping services: <service-id-1>, <service-id-2>

   Task: <another-task-slug> (<status>)
     Title: <spec title>
     Overlapping services: <service-id-3>

   These tasks modify some of the same services. Concurrent changes
   may cause merge conflicts or unexpected interactions.

   Options:
   A) Proceed anyway (I know about these tasks)
   B) Abort task creation
   ```

   If the user selects "Abort": stop the workflow. Report: "Task creation aborted due to conflicts. Review active tasks and retry."

5. **No conflicts**: continue silently to Step 8c.

---

### 8c. Dual-PR Intent

Using `question`:

> **"Will this task also need a PR to `alpha` (staging)?"**
> - No — only a PR to the main branch (`main`/`master`) (default)
> - Yes — two PRs: one to the main branch (mandatory), one to alpha (staging branch created from origin/alpha now; commits cherry-picked at PR-creation time with conflict resolver)

Store as `DUAL_PR` (boolean).

After storing `DUAL_PR`, **insert** the `## Branching` section into the existing TASKS.md file, between the `## Services` and `## Phases` sections:

```markdown
## Branching
- Dual PR: <DUAL_PR yes|no>
- Primary branch: production/<TASK_SLUG>
- Secondary branch: staging/<TASK_SLUG>   (created from origin/alpha and pushed at Step 15c when Dual PR = yes; commits arrive via cherry-pick at /jlu-ship)
- Mode: (pending — chosen after spec approval)
- Sync markers: (pending — seeded at Step 15c with `<service-id>: alpha=<creation-sha>, production=`; production filled at first dual-PR sync)
```

**Store**: `DUAL_PR`

---

## Step 10 — Load Codebase Context (selective)

For each service in `CONFIRMED_SERVICES`, read in parallel (single tool-call message):

- `<WORKSPACE_PATH>/services/<service-id>/codebase/ARCHITECTURE.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/CONVENTIONS.md`
- `<WORKSPACE_PATH>/services/<service-id>/codebase/INTEGRATIONS.md`

**Skipped by default**: `STACK.md`, `STRUCTURE.md`, `CONCERNS.md`. These are large reference docs that rarely shape a spec interview.

**Lazy-load triggers**: if `TASK_DESCRIPTION` mentions any of the following keywords, also load the matching file in the same parallel batch:
- "stack", "framework", "version", "library", "dependency", "package" → `STACK.md`
- "directory", "module structure", "file layout", "where does", "folder" → `STRUCTURE.md`
- "known issue", "tech debt", "concern", "legacy", "workaround" → `CONCERNS.md`

Track which files were loaded and which were missing (only counts default-3 misses for the warning in Step 12).

**Store**: `CODEBASE_CONTEXT` = map of service-id -> map of filename -> content

---

## Step 11 — Read Engineering Principles (conditional)

Load `<WORKSPACE_PATH>/principles/ENGINEERING_PRINCIPLES.md` ONLY if `TASK_DESCRIPTION` contains an architectural keyword: `architecture`, `security`, `performance`, `scalability`, `auth`, `schema`, `contract`, `event`, `migration`, `infrastructure`, `production`.

Rationale: principles are global guidance and add noise to scoped tasks. The interview can ask the user directly when architectural decisions arise.

If loaded but the file doesn't exist, note it and do not block. If not loaded (no keyword match), `PRINCIPLES_CONTENT` is empty string.

**Store**: `PRINCIPLES_CONTENT` = contents (or empty string if not loaded or missing)

---

## Step 12 — Warn on Missing Context

1. If ANY of the **default-3** files (`ARCHITECTURE.md`, `CONVENTIONS.md`, `INTEGRATIONS.md`) are missing for any affected service:
   - Present a warning per service:
     ```
     Missing default codebase files for <service-id>:
       - ARCHITECTURE.md
       - CONVENTIONS.md
       - (etc.)
     ```
   - Offer: "Run `/jlu-map-codebase <service-id>` to generate them? Or continue without codebase context?"
   - If user chooses to map: pause, instruct user to run `/jlu-map-codebase`, then re-run `/jlu-new-task`.
   - If user chooses to continue: proceed with whatever context is available.
2. Do NOT warn about lazy-load files (`STACK.md`, `STRUCTURE.md`, `CONCERNS.md`) being absent — they are only loaded on demand and the interview can proceed without them.

---

## Step 13 — Review Loaded Context

Before starting the interview, confirm you have loaded:
- `TASK_DESCRIPTION` from Step 3
- `CODEBASE_CONTEXT` from Step 10
- `PRINCIPLES_CONTENT` from Step 11
- `CONFIRMED_SERVICES` from Step 8
- `DETECTED_TEMPLATES`, `MERGED_PREFILL`, `MERGED_HINTS` from Step 2c

All of these are already in memory from previous steps. No assembly needed — proceed directly to the interview.

---

## Step 14 — Interview and Write Spec

> **Tool requirement reminder**: Every question and confirmation in this step MUST use `question`. Never output questions as plain text.

### 14.0 — Load Canonical Glossary (read-only)

Before gap analysis, check for a canonical glossary at `<WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.md`.

If the file exists:
- Read it.
- Extract: term names, one-sentence definitions, aliases-to-avoid.
- Hold this as `CANONICAL_TERMS` for the rest of Step 14.

If the file does not exist, skip this sub-step silently. Do NOT prompt the user to create a glossary.

> **No writes**: This sub-step (and all of Step 14) NEVER edits `UBIQUITOUS_LANGUAGE.md`, `candidates.json`, or any glossary artifact. Glossary curation happens via `/jlu-ubiquitous-language`, not here.

### 14a — Gap Analysis (silent)

Before asking any questions, silently analyze the task description (`TASK_DESCRIPTION`) against the codebase knowledge (`CODEBASE_CONTEXT`). Identify:
- Ambiguities or missing details in the task description
- Conflicts between the task and existing architecture, conventions, or integration patterns
- Implicit assumptions that need explicit confirmation
- Edge cases, error scenarios, and security implications not addressed
- Integration points with other services or systems referenced in INTEGRATIONS.md
- Non-functional requirements (performance, scalability, observability) not mentioned
- Known concerns from CONCERNS.md that intersect with this task
- For bugfix/single-path tasks, keep extra code drilldown bounded to:
  - up to 3 focused `grep` searches
  - up to 3 targeted source-file reads (<= 220 lines each)
  Escalate beyond this only if ambiguity remains after the first interview round.
- If `MERGED_HINTS` is non-empty: incorporate the merged interview hints from all auto-detected templates as high-priority gap areas. These cover domain-specific questions from each applicable template and tell you which questions are most relevant for this type of work.
- Additionally, apply domain-aware gap detection for any domains NOT already covered by detected templates:
  - **API/endpoint work**: HTTP method, URL path, auth model, request/response schema, validation rules, pagination, rate limits, partial failure handling
  - **UI/frontend work**: visual state machine (idle/loading/success/error/empty), interaction events, data source, accessibility, responsive breakpoints, animation
  - **Database/migration work**: data volume, additive vs destructive, old-code compatibility, rollback DDL, FK ordering, backfill strategy, index lock duration
  - **Event/async work**: message broker, idempotency mechanism, timeout behavior, ordering guarantees, dead letter strategy, schema versioning, consumer lag
  - **Cross-cutting tasks**: apply relevant probes from each applicable domain above

Prioritize gaps by impact: architectural decisions > behavioral requirements > edge cases > cosmetic details.

### 14b — Structured Interview

Using `question`, interview the user to resolve all identified gaps.

Rules:
- **3-6 questions per round**, grouped by theme — never random
- **Each question takes max 4 options** (hard API limit on `question`/`AskUserQuestion`). If a decision has more candidates than 4 (e.g., 7 services to route, 6 patterns to pick from), split it: ask the question across multiple rounds, group candidates into bucket options ("group A vs group B"), or use a free-text question instead of multiple-choice. **Never** stuff 5+ options into one question — the call will fail with `InputValidationError: too_big`.
- **Themes to cover** (in rough priority order):
  1. Technical implementation details (how will this be built? what patterns apply?)
  2. Tradeoffs & alternatives (why this approach over others? what are we giving up?)
  3. Architecture & design decisions (how does this fit into the existing system?)
  4. Behavioral requirements (what exactly should happen in each scenario?)
  5. Edge cases & error handling (what happens when things go wrong?)
  6. Security & authorization (who can do what? what's sensitive?)
  7. Performance & scalability (volume expectations, latency constraints?)
  8. Integration points (what other services/systems are affected?)
  9. UX/UI implications (if applicable — user-facing behavior)
  10. Constraints & out-of-scope (what should we explicitly NOT do?)
- **Ask non-obvious questions** — informed by what you found in the codebase context, not generic. Reference specific files, patterns, or conventions you observed.
  - Good: "INTEGRATIONS.md shows this service communicates with service-payments via async events. Should the new feature use the same event bus, or does it need a synchronous call?"
  - Bad: "What technology should we use?"
- **Go deep** — don't accept vague answers. If the user says "it should be fast", ask "what's the latency budget? p95 under 200ms?"
- **Ask about tradeoffs** — if the user chose approach A, ask why not B. Surface implicit decisions.
- **Continue until complete** — keep interviewing until you can confidently fill all 5 output sections.
- **Respect the user** — if the user says "that's enough" or "move on", stop the interview and write the spec with what you have.
- **Term-suggestion (when `CANONICAL_TERMS` is loaded)**: If the user mentions a word that appears as an alias-to-avoid in `CANONICAL_TERMS`, reflect back the canonical term and cite the glossary. Example: if canonical has `Workflow` with alias `Process`, and the user says "track when a Process completes", reply with "Got it — tracking Workflow completion. (Using 'Workflow' per the workspace glossary; 'Process' is listed as an alias to avoid.)"
- **Definition-anchoring (when `CANONICAL_TERMS` is loaded)**: When asking clarifying questions about a term that is in `CANONICAL_TERMS`, phrase the question in terms of the canonical definition rather than re-asking what the term means.

### 14c — Write SPEC.md

After the interview is complete, write `<TASK_DIR>/SPEC.md` with these structured sections:

```markdown
# <Task Title>

## Problem Statement
What problem this solves and why it matters. Include business context.

## Requirements

### Functional
- FR-1: <requirement>
- FR-2: <requirement>
...

### Non-Functional
- NFR-1: <requirement> (e.g., performance, security, scalability, observability)
...

## Constraints
Technical, business, or timeline constraints that bound the solution.

## Out of Scope
Explicitly excluded from this task — things that might seem related but are NOT part of this work.

## Success Criteria
How to verify the task is complete. Concrete, testable conditions. For EACH requirement that validates or types input — request body fields, typed query parameters (pagination/filter/sort), or a field that references another field/entity by id — the criteria MUST enumerate four case classes, not only the happy path. Label each criterion with its class and a back-reference to the requirement it verifies:

`- SC-<n> [success|rejection|realistic|boundary] (FR-<k>): <criterion>`

- **[success]** — valid, type-correct input produces the expected result.
- **[rejection]** — one criterion per validation rule (each typed/required/format/range constraint), asserting a violating payload is refused with the documented 4xx and does not mutate state.
- **[realistic]** — at least one criterion exercises a production-representative payload that populates every cross-field reference (collections non-empty, ids pointing at real rows), not the minimal/empty shape.
- **[boundary]** — empty collection AND its populated counterpart, missing optional, min/max.

A requirement that validates input but lists only a `[success]` criterion is incomplete. Requirements with no validated/typed input and no cross-field reference keep a single `[success]` criterion.
- SC-1 [success] (FR-1): <criterion>
- SC-2 [rejection] (FR-1): <criterion>
...

## Terms introduced by this spec

<!--
List any non-generic domain terms used in this spec that are NOT yet in the canonical glossary at .spec-workspace/glossary/UBIQUITOUS_LANGUAGE.md.
This section is read by /jlu-ubiquitous-language as one of the spec/conversation sources.
Free-text bulleted list. One line per term. No definitions required.
Skip this section entirely if all terms used here are already canonical OR if no glossary exists.
-->

- {{Term1}} — {{optional one-line context}}
- {{Term2}} — {{optional one-line context}}
```

If `MERGED_PREFILL` is non-empty:
- Use the merged pre-filled sections as the starting structure for SPEC.md.
- Replace `<!-- FILL: ... -->` placeholders with answers from the interview.
- Preserve pre-filled requirements that are still relevant; remove any that don't apply.
- Deduplicate requirements that overlap between merged templates.
- Add new requirements discovered during the interview.

If `DETECTED_TEMPLATES` is non-empty:
- Record the detected templates in a comment at the top of SPEC.md: `<!-- Templates: <template-1>, <template-2> -->`

Rules for writing:
- Preserve the user's original intent from the task description
- Add precision and detail from interview answers
- Number requirements and criteria for traceability (FR-1, NFR-1, SC-1)
- Make every requirement concrete enough that a developer could implement it and a QA agent could verify it
- The spec must be directly usable by the proposal-agent to generate PROPOSAL.md without ambiguity
- If `CANONICAL_TERMS` is empty (no glossary exists), OMIT the `## Terms introduced by this spec` section entirely from `SPEC.md`.
- If `CANONICAL_TERMS` is non-empty, populate the `## Terms introduced by this spec` section with every domain term used in `SPEC.md` that is NOT in `CANONICAL_TERMS`. Apply the same domain-specificity filter as `agents/jlu-glossary-extractor.md` — skip generic programming nouns. If no terms qualify, write the section header followed by `<!-- No new domain terms introduced. -->`.

**Case-Coverage self-check (before the spec may reach `status=planned`).** For every FR that validates or types input — request body, typed query parameters, or a cross-field reference — confirm the Success Criteria include at least one `[rejection]` criterion per validation rule and at least one `[realistic]` populated-reference criterion. The "that's enough" / "1-2 rounds" escape hatches (Principles, lines 17 and 20) do NOT waive this floor for a validated-input FR — if the user stops the interview early, write the missing `[rejection]` / `[realistic]` criteria from the validation rules you already gathered rather than shipping a happy-path-only spec. This is the spec-side expression of the case-matrix floor that `jlu-test-writer` and `jlu-tdd-cycle` enforce at the test layer.

### 14c-2 — Author user-story files (decentralized specs)

The SPEC.md written in 14c stays the record. In addition, decompose it into small,
self-contained **user-story** files under `<TASK_DIR>/stories/` — one per deliverable
behavior (a single story for a small task). These are the units the TDD agents consume
during `/jlu-execute-task`; each carries its own acceptance so an agent needs nothing
outside the story plus the codebase docs.

For each story, write `<TASK_DIR>/stories/<NN>-<slug>.story.md` from the template at
`<PLUGIN_ROOT>/jelou/templates/user-story.md`, where `<NN>` is a two-digit order prefix
(`01`, `02`, …). Fill:
- **Frontmatter**: `id` (`us-<N>`), `title`, `actor`, `services` (≥1, each must exist in
  `<WORKSPACE_PATH>/registry/services.yaml`), `depends-on` (story ids this one needs, or `[]`),
  `service-order` (intra-story service order when a cross-service contract exists, else `[]`),
  and `covers` — the SPEC FR ids this story delivers (e.g. `[FR-1, FR-3]`).
- **`## Acceptance Criteria`**: self-contained labeled bullets
  `[success]`/`[rejection]`/`[realistic]`/`[boundary]` — do NOT reference "the SPEC". Reuse the
  case taxonomy already written in `## Success Criteria`. Every story needs ≥1 `[success]`.
- **`## Phase Mapping`** is optional — leave the template stub as-is.

**Coverage invariant** (enforced by the Step 15 gate before `status=planned`): every FR in
SPEC.md is covered by ≥1 story (matched by FR id in `covers`, not by prose), and no story
covers an FR that SPEC.md does not define. If a UI service is in scope, at least one story
touching it carries a browser-level `[success]` criterion — the E2E guard is not waived here.

### 14d — Present for Approval

> **Never print the SPEC.md content in the terminal.** The user reviews the spec by opening the file in their editor — the terminal carries only the file path and a short summary. Dumping the full spec into the conversation is a defect.

1. Print the spec location on its own line as an **absolute path** (terminals render it clickable):

   ```
   SPEC.md written: <absolute-TASK_DIR>/SPEC.md
   ```

2. Then, using `question`, ask for approval. The question contains only:
   - A brief executive summary of what the spec covers (3-5 sentences, never the spec body)
   - A count of requirements (FR: X, NFR: Y) and success criteria (SC: Z)
   - Any areas where you had to make judgment calls or where information was incomplete
   - Ask clearly: "Do you approve this spec to move to `planned` status?"

If the user wants changes, make them and re-present (print the path line again after each rewrite). Loop until the user approves or explicitly stops.

---

## Step 15 — Post-Interview Confirmation

After the user approves (or declines) the spec:

1. Verify that `<TASK_DIR>/SPEC.md` exists and has all 5 structured sections.
   - If not created or incomplete: warn "SPEC.md could not be completed. Review the interview output."

1b. Create the version history:
    a. Create `<TASK_DIR>/versions/` directory.
    b. Copy `<TASK_DIR>/SPEC.md` to `<TASK_DIR>/versions/SPEC-v1.md`.
    c. Write `<TASK_DIR>/versions/SPEC-changelog.md`:
       ```markdown
       # Spec Changelog

       ## v1 (<current-date>)
       Initial spec created via /jlu-new-task interview.
       Templates auto-detected: <DETECTED_TEMPLATES or "none">
       ```

1c. **Coherence gate (stories ↔ SPEC) — mandatory before `planned`.** Run:

    ```
    node <PLUGIN_ROOT>/bin/validate-stories.mjs <TASK_DIR>/stories \
      --services <WORKSPACE_PATH>/registry/services.yaml \
      --spec <TASK_DIR>/SPEC.md
    ```

    - **Exit 0** → every story is well-formed and every FR is covered; continue.
    - **Exit 1** → print the stderr lines verbatim (they name the offending story + field, the
      uncovered FR, or the orphan story). Do NOT transition the task to `planned`. Fix the story
      files (re-run 14c-2, or re-interview) and re-run the gate until it passes. Skipping this
      gate lets SPEC↔story drift ship silently — it is not optional.

2. If the user **approved** the spec AND the Step 1c gate passed:
   a. Update `<TASK_DIR>/TASKS.md`:
      - Replace the existing `## Status: refining` line in place with `## Status: planned` (do not append a second status heading)
      - Add transition timestamp: `- Planned: <current-datetime-ISO>`
      - Verify there is exactly one `## Status:` line after the update
3. If the user **did not approve** or the interview ended without approval:
   a. Leave TASKS.md status as `refining`.
   b. Report: "SPEC.md was created but not yet approved. You can:"
      - "Review and edit `<TASK_DIR>/SPEC.md` manually, then re-run `/jlu-new-task <TASK_SLUG>`"
      - "Or re-run `/jlu-refine-task <TASK_SLUG>` to apply targeted changes"

---

## Step 15b — Mode Selection

Runs only if the user approved the spec in Step 15.

Using `question`:

> **"How should I set up the work environment for this task?"**
> - Full setup (worktree + Docker) — recommended when multiple services, Docker-heavy, or parallel tasks planned
> - Branch only — recommended when single-file fix, non-Docker service, or quick change

Store as `SETUP_MODE` ∈ {`worktree`, `branch`}.

Update `<TASK_DIR>/TASKS.md` → `## Branching` → replace `Mode: (pending ...)` with `Mode: <SETUP_MODE>`.

**Store**: `SETUP_MODE`

---

## Step 15c — Dispatch Setup Subtask

Runs only if the user approved the spec in Step 15.

Notify the user:
```
Setting up work environment (<SETUP_MODE> mode) for <N> services...
```

Spawn a task subagent using `jlu-git-agent` with `MODEL_CONFIG.operational` (default haiku). Pass:
- `CONFIRMED_SERVICES` (list)
- `TASK_SLUG`
- `SETUP_MODE` ∈ {`worktree`, `branch`}
- `DUAL_PR` (boolean)
- Per-service repo paths from `services.yaml`

The subtask executes the following per-service algorithm.

### Source-branch verification (both modes)

For each service in `CONFIRMED_SERVICES`:

1. `cd <repo>` and run `git fetch origin` to get latest refs.
2. Detect trunk:
   ```bash
   TRUNK=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
   [ -z "$TRUNK" ] && TRUNK=main
   git rev-parse --verify origin/$TRUNK >/dev/null 2>&1 || TRUNK=master
   ```
3. If `origin/$TRUNK` still does not resolve, abort this service: **"Cannot resolve trunk branch for `<service-id>`."**

**In branch mode only**, additionally:

4. Check working tree cleanliness:
   ```bash
   DIRTY=$(git status --porcelain)
   ```
   If `DIRTY` is non-empty, abort this service with the first 5 dirty paths plus the total count: **"Working tree of `<service-id>` is dirty. Commit or stash before branch-only mode can create branches in place. Dirty files: `<paths...>` (total: N)."**
5. Check current HEAD:
   ```bash
   CURR=$(git rev-parse --abbrev-ref HEAD)
   ```
   If `CURR != $TRUNK`, abort: **"`<service-id>` is currently on `$CURR`, not `$TRUNK`. Check out `$TRUNK` first."**

In worktree mode, skip steps 4 and 5 — the main repo's HEAD and working-tree state do not affect worktree creation.

### Branch creation

**If `SETUP_MODE = worktree`** (existing five-phase behavior):

1. **Pre-flight: verify `.worktrees/` is git-ignored** in this service repo. Without this, worktree contents pollute the repo's tracked state and may be staged by accident.
   ```bash
   git -C <repo> check-ignore -q .worktrees
   ```
   If the command exits non-zero (`.worktrees/` is **not** ignored): abort this service and escalate to the user with: **"Service `<service-id>` does not git-ignore `.worktrees/`. Add `.worktrees/` to the service's `.gitignore` and commit it before re-running `/jlu-new-task`. The plugin will not auto-modify the service repo's `.gitignore`."**
   If the command exits 0 (already ignored): proceed.
2. Create the worktree on the new branch:
   ```bash
   git worktree add .worktrees/<TASK_SLUG> -b production/<TASK_SLUG> origin/$TRUNK
   ```
   If `production/<TASK_SLUG>` already exists locally, abort this service: **"Branch `production/<TASK_SLUG>` already exists locally for `<service-id>`. Delete it or use a different slug."**
3. Copy untracked files from repo root to worktree:
   ```bash
   for file in .env .npmrc; do
     [ -f <repo>/$file ] && cp <repo>/$file <worktree>/$file
   done
   ```
4. Run the Docker isolation phases per `jelou/references/docker-conventions.md`: port allocation, `docker-compose.override.yml` generation, inter-service URL wiring, and `docker compose up -d`. Wherever those phases would have referenced `spec/<TASK_SLUG>`, use `production/<TASK_SLUG>`.

**If `SETUP_MODE = branch`** (new):

1. Create the branch (not checked out):
   ```bash
   git branch production/<TASK_SLUG> origin/$TRUNK
   ```
   If the branch already exists, abort this service: **"Branch `production/<TASK_SLUG>` already exists locally for `<service-id>`. Delete it or use a different slug."**
2. Skip Docker phases entirely. No `.env` copy, no override file, no port allocation, no container bring-up.

### Staging branch creation (Dual PR only)

Runs per service only when `DUAL_PR = yes`. Independent of `SETUP_MODE` — `staging/<TASK_SLUG>` is always a plain local branch (no worktree, no checkout, no Docker), created via the git-agent's "Staging Branch Initialization" procedure:

```bash
git rev-parse --verify origin/alpha >/dev/null 2>&1 || { echo "no-alpha"; exit 0; }
git rev-parse --verify staging/<TASK_SLUG> >/dev/null 2>&1 && { echo "staging-exists"; exit 1; }
git branch staging/<TASK_SLUG> origin/alpha
git push origin staging/<TASK_SLUG>
CREATION_ALPHA_SHA=$(git rev-parse origin/alpha)
```

Aborts here are per-service and non-blocking — the trunk side always proceeds:
- `origin/alpha` does not resolve → skip staging for this service: **"`<service-id>` has no `alpha` branch at origin. Staging branch not created; trunk side proceeds."**
- `staging/<TASK_SLUG>` already exists locally → skip staging for this service: **"Branch `staging/<TASK_SLUG>` already exists locally for `<service-id>`. Delete it or use a different slug."**

Record per service: `staging_branch` ∈ {`created`, `skipped-no-alpha`, `skipped-exists`} and `creation_alpha_sha` (when created).

### Seed sync markers (Dual PR only)

After the setup subtask returns, for each service where `staging_branch = created`, write its seed into `<TASK_DIR>/TASKS.md` → `## Branching` → `Sync markers` (create the block if absent), replacing the `(pending …)` line:

```
- Sync markers:
  - <service-id>: alpha=<creation_alpha_sha>, production=
```

The empty `production=` value tells `/jlu-ship` that no commits have been cherry-picked yet (its 5b.3 "first-pick" path). Services with `skipped-no-alpha` or `skipped-exists` get no marker line.

### Record

Record per service: `{ mode, production_branch, worktree_path (if worktree mode), staging_branch (if Dual PR), creation_alpha_sha (if staging created) }`. The orchestrator includes this in the final report (Step 16).

### Error handling

- Per-service aborts do NOT block the workflow. The orchestrator continues with remaining services and reports all aborts in the final report.
- If the subtask itself crashes (Claude session interruption, infrastructure), any partial state (created branches, open worktrees) is left on disk. Re-running `/jlu-new-task <slug>` will detect existing branches and abort per-service with the "already exists" message.

---

## Step 16 — Final Report

Present the final summary:

```
## Task Created

### Task
- Slug: <TASK_SLUG>
- Path: <absolute-TASK_DIR>
- Sprint: <SPRINT_NUMBER>
- Status: planned

### Artifacts
- SPEC.md: <absolute-TASK_DIR>/SPEC.md (<N> sections)
- TASKS.md: <absolute-TASK_DIR>/TASKS.md

### Affected Services
- <service-id-1> (primary)
- <service-id-2>
- ...

### Branching
- Mode: <SETUP_MODE>
- Dual PR: <DUAL_PR yes|no>
- Branches created:
  <service-id-1>: production/<TASK_SLUG>[, staging/<TASK_SLUG> (pushed)]
  <service-id-2>: production/<TASK_SLUG>[, staging/<TASK_SLUG> (pushed)]
  ...

### Worktrees (Mode: worktree only)
- <service-id-1>: <repo-path>/.worktrees/<TASK_SLUG>
- ...

### Docker Instances (Mode: worktree only)
- <service-id-1>: running on port <port> (container: <id>)
- <service-id-2>: no Docker
- ...

### Warnings
- <any codebase map warnings>
- <any skill staleness warnings>
- <any unregistered service warnings>
- <any setup-subtask per-service aborts>

### Next Step
Run `/jlu-execute-task` to begin implementation.
```

When the auto-chain engages (see "ClickUp sync & auto-chain handoff" below),
replace the `Next Step` line with
`Auto-chain engaged — continuing into /jlu-execute-task in this session.`

**ClickUp sync & auto-chain handoff (after the spec reaches `planned`):**
follow the shared recipe in
`{plugin-root}/jelou/references/autochain-handoff.md`.

1. **ClickUp create-or-bind (non-blocking, recipe §1).** Inline reference
   given → bind and follow the task-clickup workflow's UPDATE path. None →
   read `{plugin-root}/jelou/workflows/task-clickup.md` and follow its CREATE
   path — the task exists on the sprint board for the whole implementation,
   not only at ship time. Update TASKS.md External Links accordingly.
2. **Auto-chain handoff (recipe §2-§3).** Resolve the flag per the recipe;
   `true` → hand off inline into execute-task with the new `<TASK_SLUG>`;
   `false` or opted out → print the manual `Next Step` as today.

**Mode-specific appendices:**

If `SETUP_MODE = branch`: append to the report:

> Branch-only mode: `/jlu-execute-task` will check out `production/<TASK_SLUG>` in each affected service repo before its first phase. Ensure working trees are clean at that point.

If `DUAL_PR = yes`: append to the report:

> Dual-PR enabled. The `staging/<TASK_SLUG>` branch was created from `origin/alpha` and pushed for each affected service (skipped for any service lacking an `alpha` branch). Production commits are cherry-picked onto it at `/jlu-ship` — reusing the branch when `alpha` is unchanged, rebuilding from fresh `origin/alpha` when it moved — with conflicts resolved by the `jlu-conflict-resolver` sub-agent.

---

## Error Handling

| Error | Action |
|-------|--------|
| Cannot resolve workspace | Offer to create, stop if user declines |
| Service not registered | Offer to register, warn if declined |
| Task slug already exists | Auto-append numeric suffix |
| Git worktree creation fails | Background agent reports error, skip that worktree, continue |
| INTEGRATIONS.md missing | Proceed without integration-based detection, rely on user input |
| Codebase files missing | Warn, offer `/jlu-map-codebase`, allow continue without |
| Interview interrupted (session timeout, user abort) | Save any spec content written so far, report partial state |
| User cancels at any confirmation step | Save any artifacts created so far, report partial state |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| Task spec | `.spec-workspace/specs/<dd-mm-yyyy>/<task-slug>/SPEC.md` |
| Task tracker | `.spec-workspace/specs/<dd-mm-yyyy>/<task-slug>/TASKS.md` |
| Per-service dir | `.spec-workspace/specs/<dd-mm-yyyy>/<task-slug>/services/<service-id>/` |
| Phase dir | `.spec-workspace/specs/<dd-mm-yyyy>/<task-slug>/services/<service-id>/phases/` |
| User stories dir | `.spec-workspace/specs/<dd-mm-yyyy>/<task-slug>/services/<service-id>/uh/` |
| Worktree | `<service-repo>/.worktrees/<task-slug>` |
| Branch (primary) | `production/<task-slug>` (in each affected service repo) |
| Branch (alpha, opt-in) | `staging/<task-slug>` (created from `origin/alpha` and pushed at `/jlu-new-task` Step 15c when Dual PR = yes; commits cherry-picked at `/jlu-ship`) |
| Temp staging worktree | `<service-repo>/.worktrees/<task-slug>-staging-tmp` (ephemeral, dual-PR sync only) |

---

## Step N — Close workflow span

Determine `$WORKFLOW_OUTCOME`:
- `ok` — the spec reached `planned` state
- `blocked` — interview aborted (user halted, or required input missing)
- `failed` — irrecoverable error

Run:
```bash
node "${PLUGIN_ROOT:-.}/bin/trace-end-span.mjs" \
  --span "$WORKFLOW_SPAN_ID" --status "$WORKFLOW_OUTCOME" \
  ${TASK_SLUG:+--outcome "task=$TASK_SLUG"}
```

Empty `$WORKFLOW_SPAN_ID` (when `TRACE_DISABLED=1`) makes this a no-op.
