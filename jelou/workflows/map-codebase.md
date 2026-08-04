# Workflow: map-codebase

> Orchestrator workflow for `/jlu-map-codebase [service-id | --root [root-path] | --all]`
> Maps one service's codebase, or maps every project under a root directory using
> one parallel mapper agent per project.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `question`. Never output questions as plain text.

---

## Step 0 — Select Run Mode

1. Parse command arguments before resolving a service:
   - `--root`, `--root <path>`, `--root=<path>`, `--all`, or `--batch` set `RUN_MODE` = `batch`.
   - `--defer-interview` sets `BATCH_INTERVIEW_MODE` = `deferred`.
   - `--interview` sets `BATCH_INTERVIEW_MODE` = `provided`.
   - A non-flag argument without a batch flag remains the single-service `service-id`.
2. If no service-id and no batch flag were provided, auto-detect batch mode only when all are true:
   - The current directory has no `.spec-workspace.json`.
   - The current directory does not pass the repository-root gate from Step 4.
   - At least one immediate child directory passes the repository-root gate from Step 4.
3. For batch mode:
   - Set `ROOT_PATH` to the explicit `--root` path, or to the current directory when omitted.
   - Execute **Batch Root Mode** below.
   - Stop before **Single-Service Mode**. Do not fall through into Step 1.
4. For single-service mode, continue to Step 1 unchanged.

---

## Batch Root Mode — Map All Projects Under a Root

Batch mode is intentionally flat: the orchestrator dispatches one `jlu-codebase-mapper`
worker per service. A mapper worker must not invoke `/jlu-map-codebase` and must not
dispatch structural, operational, glossary, or any other subagents. This keeps Codex
within `agents.max_depth = 1` and keeps OpenCode/Claude Code behavior equivalent.

### B1. Resolve Root and Workspace

1. Normalize `ROOT_PATH` to an absolute path.
2. Error gate: stop if `ROOT_PATH` does not exist, is not a directory, resolves to `/`,
   or is empty.
3. Resolve one shared `WORKSPACE_PATH` for the whole root:
   a. If `<ROOT_PATH>/.spec-workspace.json` exists, read its `workspace` field and
      resolve it relative to `ROOT_PATH`.
   b. Else if `<ROOT_PATH>/.spec-workspace/` exists, use it.
   c. Else search parent directories up to 5 levels for `.spec-workspace/`.
   d. Else create `<ROOT_PATH>/.spec-workspace/` with:
      ```
      .spec-workspace/
        registry/
          services.yaml
        principles/
          ENGINEERING_PRINCIPLES.md
        services/
        specs/
      ```
      Then create `<ROOT_PATH>/.spec-workspace.json` pointing to `.spec-workspace/`.
4. Root mode owns this single shared workspace. Do not let child project
   `.spec-workspace.json` files redirect individual workers to other workspaces.

**Store**: `ROOT_PATH`, `WORKSPACE_PATH`

### B2. Discover Projects

Build `SERVICE_TARGETS`, a list of `{service-id, SOURCE_ROOT}`:

1. Read `<WORKSPACE_PATH>/registry/services.yaml` if it exists.
   - For each service entry with a `path`, resolve the path relative to `WORKSPACE_PATH`.
   - Keep entries whose resolved path exists and passes the repository-root gate from Step 4.
   - Preserve the registry `id` as `service-id`.
   - Record missing or invalid registry paths as skipped targets for the final report.
2. Scan immediate child directories of `ROOT_PATH`.
   - Exclude `.spec-workspace`, `.git`, `node_modules`, `vendor`, `dist`, `build`,
     `.cache`, `.next`, `coverage`, and hidden directories unless they are already in
     `services.yaml`.
   - A child is a project when it passes the repository-root gate from Step 4.
   - Derive `service-id` from the directory basename by trimming whitespace, replacing
     whitespace with `-`, and removing characters outside `[A-Za-z0-9._-]`.
3. De-duplicate by absolute `SOURCE_ROOT`. Registry entries win over scanned entries.
4. Error gate: if two targets resolve to the same `service-id` but different paths,
   ask the user to provide unique service IDs before dispatching any workers.
5. Error gate: if `SERVICE_TARGETS` is empty, stop with:
   > "No projects found under `<ROOT_PATH>`. Run `/jlu-map-codebase <service-id>` from a service repo or pass `/jlu-map-codebase --root <path>`."

**Store**: `SERVICE_TARGETS`

### B3. Resolve Batch Interview Mode

Per-service interviews are not run in batch mode because parallel workers must not
compete for user prompts.

1. If `--interview` was provided, ask one consolidated `question` before dispatch:
   > "Batch mapping will not ask per-service questions. Share any known scaling limits, planned deprecations, fragile areas, or security concerns that should be included across these services. Reply `none` to continue without user concerns."
   Store the answer as `USER_CONCERNS` and set `BATCH_INTERVIEW_MODE` = `provided`.
2. If `--defer-interview` was provided, set `BATCH_INTERVIEW_MODE` = `deferred`.
3. If neither flag was provided, default `BATCH_INTERVIEW_MODE` = `deferred` and
   `USER_CONCERNS` = `none provided`.

Workers must write `CONCERNS.md` with code-derived findings plus either the provided
batch concerns or a clear note: `User interview deferred by root batch mode`.

**Store**: `BATCH_INTERVIEW_MODE`, `USER_CONCERNS`

### B4. Dispatch Service Mappers

1. Set `BATCH_PARALLELISM` from `JLU_PHASE_PARALLELISM` (default `1`), clamped to
   `1..len(SERVICE_TARGETS)`.
2. For each target, compute `OUTPUT_DIR` =
   `<WORKSPACE_PATH>/services/<service-id>/codebase/` and create it if missing.
3. Dispatch `jlu-codebase-mapper` (model: **sonnet**) once per target.
   - If `BATCH_PARALLELISM > 1`, dispatch up to `BATCH_PARALLELISM` mapper workers
     in a single orchestrator message. If there are more targets than the cap,
     process chunks sequentially.
   - If `BATCH_PARALLELISM = 1`, run targets sequentially in discovery order.
4. Each mapper prompt must include:
   ```
   Service ID: <service-id>
   SOURCE_ROOT: <absolute source root>
   OUTPUT_DIR: <absolute output directory>
   WORKSPACE_PATH: <absolute workspace path>
   PLUGIN_ROOT: <plugin-root>
   INTERVIEW_MODE: <BATCH_INTERVIEW_MODE>
   USER_CONCERNS: <USER_CONCERNS or "none provided">
   Safety: Scope all file operations and Bash commands to SOURCE_ROOT for reads, and to OUTPUT_DIR for writes. Never scan /, /proc, /sys, /dev, /run, or home-level container storage paths.
   Batch constraints:
   - Do not invoke /jlu-map-codebase or any jlu-* prompt/command.
   - Do not dispatch subagents or use task/Agent.
   - Do not write registry/services.yaml, glossary files, or files outside OUTPUT_DIR.
   - Run the single-service mapping body inline: incremental detection, document generation/update, consistency check, and .last-analysis.json marker.
   - Read <PLUGIN_ROOT>/agents/jlu-codebase-analyzer-structural.md and <PLUGIN_ROOT>/agents/jlu-codebase-analyzer-operational.md, then apply those analyzer instructions inline.
   - Do not ask the user questions. Use USER_CONCERNS or mark the user interview deferred.
   - Emit the standard subagent JSON summary with artifacts as absolute output doc paths.
   ```

**Store**: `MAPPER_RESULTS`

### B5. Validate Mapper Results

After each chunk returns:

1. For every successful mapper, verify all 6 files exist and are non-empty:
   - `<OUTPUT_DIR>/ARCHITECTURE.md`
   - `<OUTPUT_DIR>/STACK.md`
   - `<OUTPUT_DIR>/STRUCTURE.md`
   - `<OUTPUT_DIR>/CONVENTIONS.md`
   - `<OUTPUT_DIR>/INTEGRATIONS.md`
   - `<OUTPUT_DIR>/CONCERNS.md`
2. If a mapper reports `blocked` or `failed`, keep processing other chunks but record
   the service as failed in the final report.
3. If validation fails for a service, mark that service failed and do not register it.

**Store**: `SUCCESSFUL_SERVICES`, `FAILED_SERVICES`, `SKIPPED_SERVICES`

### B6. Update Registry Once

Registry writes are shared state. Do this only in the root orchestrator after mapper
workers finish.

1. Read `<WORKSPACE_PATH>/registry/services.yaml`. If missing, create it with
   `services: []`.
2. For each successful service:
   - If an entry exists and its `path` resolves to a different path, update the path.
   - If an entry exists and its path is correct, leave it unchanged.
   - If no entry exists, append one using the same stack/path/docker derivation rules
     from Step 7c.
3. Write `services.yaml` once after applying all service changes.
4. Record `REGISTRY_ACTION[service-id]` as `registered`, `path-updated`,
   `already-registered`, or `skipped (<reason>)`.
5. **Derive + persist missing `dev` blocks (orchestrator-side, fail-soft).** For each
   successful service whose entry — pre-existing or just appended — has no `dev` block, run
   `node <plugin-root>/bin/derive-dev-block.mjs <SOURCE_ROOT> --stack <stack>` (append
   `--compose-file <docker.compose_file>` when the entry already declares one, so the derivation
   uses the same compose file the registry does instead of re-discovering it):
   - Exit `3` → record `CERTIFICATION[service-id]` = `exit-3(<reason>)` and continue.
   - Derivable → persist via
     `node <plugin-root>/bin/verify-dev-block.mjs --persist-block --workspace <WORKSPACE_PATH> --service <service-id> --block-file -`
     (block JSON on stdin; exit `5` = mtime conflict → re-read the registry and retry once;
     a second `5` → WARN and continue).

   Mapper workers remain forbidden from registry writes and subagent dispatch — derivation,
   persistence, and every verifier dispatch happen only orchestrator-side, here and in B6b.

### B6b. Sequential Dev-Block Verification

> Fail-soft: every failure in this phase is a WARN row in the B8 report. It never blocks
> the docs deliverable.

This phase runs after B6 by construction: the batch constraints already forbid mappers from
writing the registry or dispatching subagents, so certification can only happen once the
orchestrator owns the registry again.

1. Build `VERIFY_TARGETS`: every successful service whose entry now has a `dev` block that
   is **unmarked** — no `verified` mark at all, OR a `verified.block_hash` that no longer
   matches the current block per
   `node <plugin-root>/bin/verify-dev-block.mjs --hash --workspace <WORKSPACE_PATH> --service <service-id>`
   (→ `{ "block_hash": "..." }`; a mismatch means the block was hand-edited after marking
   and counts as unmarked). This covers both the blocks freshly derived in B6 AND
   pre-existing hand-authored blocks that were never certified. A block whose mark is
   current is `already-verified` — skip it; already-marked blocks are never re-verified.
2. For each target, **sequentially — one verifier dispatch at a time, concurrency 1, never
   in parallel** (one boot at a time is the same RAM-gate discipline as the
   `env-lifecycle.md` preflight; parallel boots have frozen machines), dispatch
   `jlu-dev-block-verifier` (subagent_type `jlu:jlu-dev-block-verifier`, bare fallback)
   with `SERVICE_ID`, `WORKSPACE_PATH`, `CHECKOUT_PATH=<SOURCE_ROOT>` (the canonical
   `svc.path`), `PLUGIN_ROOT`.
3. Handle each verdict exactly as in Step 7c.6d–f: `GREEN` + `COMMAND_EXECUTED: true` →
   `--write-mark` (exit `5` → re-read and retry once); `GREEN_PREEXISTING` → no mark +
   note; `FAILED`/`ERROR` → no mark + WARN with `CAUSE`.
4. Record `CERTIFICATION[service-id]`: `derived+verified` | `derived-unverified(<cause>)` |
   `pre-existing-verified` (hand-authored block, unmarked, passed this run) |
   `pre-existing-unverified(<cause>)` (includes a stale mark's hash-mismatch) |
   `green-preexisting` | `exit-3(<reason>)` | `already-verified`.

**Operational precondition (migration runs):** to allow the verifier to execute a boot command, the dev
stack must be DOWN (run `/jlu-stop-dev` or stop your dev servers before the batch) —
with the containers already serving, the idempotence probe yields mass `green-preexisting`
and no service earns a mark. The report will say so, but the run loses its purpose. The
inverse is never done: map-codebase NEVER stops a running dev process to force a
verification.

### B7. Glossary Extraction and Merge Once

> Fail-soft: glossary extraction must never block the mapped codebase docs.

1. If there are no successful services, skip glossary extraction.
2. Create `<WORKSPACE_PATH>/glossary/` and `<WORKSPACE_PATH>/glossary/.tmp/` if missing.
3. Dispatch one `jlu-glossary-extractor` per successful service, capped by
   `BATCH_PARALLELISM`, with each extractor writing a unique fragment:
   `<WORKSPACE_PATH>/glossary/.tmp/<service-id>.candidates.json`.
4. After all extractor workers return, run the merger exactly once:
   ```bash
   node <plugin-root>/bin/glossary-merge.mjs --glossary-dir <WORKSPACE_PATH>/glossary
   ```
5. If any extractor or the merger fails, record a warning and continue.

### B8. Batch Report Summary

Present a final summary:

```
## Map Codebase Batch Complete — <ROOT_PATH>

### Services
| Service | Source | Result | Registry | Certification | Notes |
|---|---|---|---|---|---|
| <service-id> | <SOURCE_ROOT> | mapped / skipped / failed | <REGISTRY_ACTION> | <CERTIFICATION> | <notes> |

Certification states: `derived+verified` | `derived-unverified(<cause>)` |
`pre-existing-verified` | `pre-existing-unverified(<cause>)` | `green-preexisting` |
`exit-3(<reason>)` | `already-verified`.

### Batch
- Services discovered: <N>
- Services mapped: <N>
- Services failed: <N>
- Parallelism: <BATCH_PARALLELISM>
- Interview mode: <BATCH_INTERVIEW_MODE>

### Glossary
- New candidate terms: <added count from merger output, or "skipped">
- Skipped: <skipped count from merger output, or "skipped">
- Run `/jlu-ubiquitous-language` to curate the workspace glossary.
```

Then stop.

---

## Single-Service Mode

## Step 1 — Resolve Service ID

1. If `service-id` was provided as a command argument, use it directly.
2. If not provided:
   a. Read `.spec-workspace.json` from the current working directory.
   b. If the file exists, extract the `serviceId` field and use it.
   c. If the file does not exist, ask the user:
      > "No `.spec-workspace.json` found in this directory. What is the service ID for this codebase?"

**Error gate**: If no service-id can be resolved, stop and explain what is needed.

---

## Step 2 — Resolve Workspace Path

1. Read `.spec-workspace.json` from the current directory.
   - If it exists, extract the `workspace` field (path to `.spec-workspace/`).
   - Resolve the path relative to the current directory.
2. If `.spec-workspace.json` is missing or the `workspace` path does not exist on disk:
   a. Search parent directories (up to 5 levels) for a `.spec-workspace/` directory.
   b. If found at a different path than configured:
      > "Found `.spec-workspace/` at `<found-path>` but `.spec-workspace.json` points to `<configured-path>`. Update the config?"
   c. If not found anywhere:
      > "No `.spec-workspace/` found. Create one at `../.spec-workspace/`?"
      - If user confirms, create the base directory structure:
        ```
        ../.spec-workspace/
          registry/
            services.yaml
          principles/
            ENGINEERING_PRINCIPLES.md
          services/
          specs/
        ```
      - Create or update `.spec-workspace.json` in the current directory to point to it.

**Store**: `WORKSPACE_PATH` = resolved absolute path to `.spec-workspace/`

---

## Step 3 — Create Output Directory

1. Compute the output directory: `<WORKSPACE_PATH>/services/<service-id>/codebase/`
2. If the directory does not exist, create it (including any missing parent directories).

**Store**: `OUTPUT_DIR` = absolute path to the codebase output directory.

---

## Step 4 — Determine Source Code Root

1. If the orchestrator is running from within the service's repository (the current directory contains source code):
   - Use the current working directory as the source root candidate.
2. If the `service-id` was provided as an argument (and we might not be in the service repo):
   a. Read `<WORKSPACE_PATH>/registry/services.yaml`.
   b. Find the entry matching the `service-id`.
   c. Resolve the `path` field relative to the workspace directory.
   d. Verify the path exists.
3. If the source root cannot be determined:
   - Ask the user: "Where is the source code for `<service-id>`? Provide the absolute or relative path."
4. Normalize the resolved path to an absolute path and store it as `SOURCE_ROOT`.
5. Log once before continuing: `Resolved SOURCE_ROOT=<SOURCE_ROOT>`.

**Store**: `SOURCE_ROOT` = absolute path to the service's source code.

**Error gate**: Stop and report the error if any of these are true:
- `SOURCE_ROOT` does not exist, is not a directory, or is empty.
- `SOURCE_ROOT` resolves to `/`.
- `SOURCE_ROOT` does not look like a repository root (missing all of: `.git`, `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml`, `pom.xml`, `composer.json`).

If this gate fails, ask the user for an explicit path and re-validate before proceeding.

---

### 4b. Detect Incremental Mode

1. Check if `<OUTPUT_DIR>/.last-analysis.json` exists.
2. If it exists:
   a. Read the JSON and extract the `commit` SHA.
   b. Verify all 6 docs exist in `<OUTPUT_DIR>/` (ARCHITECTURE.md, STACK.md, STRUCTURE.md, CONVENTIONS.md, INTEGRATIONS.md, CONCERNS.md).
   c. If any doc is missing: set `ANALYSIS_MODE` = `full` and continue to Step 5.
   d. Run: `git -C <SOURCE_ROOT> diff <commit>..HEAD --stat`
   e. If no changes: log "Codebase unchanged since last analysis (commit <commit>). Skipping." Run Step 7c (Ensure Registry Entry) so re-runs heal a missing registry entry or a missing `dev` block, then skip to Step 9 (report).
   f. If changes exist: categorize changed files and set `ANALYSIS_MODE` = `incremental`.
3. If `.last-analysis.json` does not exist: set `ANALYSIS_MODE` = `full` and continue to Step 5.

**File categorization heuristic:**

For each changed file in the diff stat, classify which docs it affects:

| Changed file pattern | Affects |
|---|---|
| New/deleted directories, `*/routes/*`, `*/controllers/*`, `*/handlers/*`, entry points (`main.*`, `app.*`, `index.*`) | ARCHITECTURE.md |
| `package.json`, `*.lock`, `go.mod`, `go.sum`, `composer.json`, `Cargo.toml`, framework config files | STACK.md |
| Any new, deleted, or renamed file | STRUCTURE.md |
| `.eslintrc*`, `.prettierrc*`, `tsconfig.json`, `jest.config.*`, `.editorconfig`, test config files | CONVENTIONS.md |
| `*/clients/*`, `*/events/*`, `*/providers/*`, `.env*`, `*/api/*` route files, webhook handlers | INTEGRATIONS.md |
| Files matching `TODO\|FIXME\|HACK\|DEPRECATED` in the diff content, deprecated dependency updates | CONCERNS.md |

A single changed file can affect multiple docs.

Build `DOCS_TO_UPDATE` = set of doc names that need updating.

**Determine which agents to run:**
- If `DOCS_TO_UPDATE` contains any of {ARCHITECTURE, STACK, STRUCTURE}: run structural agent in incremental mode
- If `DOCS_TO_UPDATE` contains any of {CONVENTIONS, INTEGRATIONS, CONCERNS}: run operational agent in incremental mode
- Track which specific docs each agent should update: `STRUCTURAL_DOCS_TO_UPDATE`, `OPERATIONAL_DOCS_TO_UPDATE`

**Store**: `ANALYSIS_MODE`, `DOCS_TO_UPDATE`, `STRUCTURAL_DOCS_TO_UPDATE`, `OPERATIONAL_DOCS_TO_UPDATE`, `CHANGED_FILES_STAT`, `LAST_COMMIT`

---

## Step 5 — Spawn Research Agents

### Full Mode (ANALYSIS_MODE = full)

Spawn both agents using the task tool. Honor `JLU_PHASE_PARALLELISM` from the environment (default `1`): when `> 1`, fan out the two analyzers in a single orchestrator message; when `= 1`, run them sequentially (structural first, then operational, so the operational analyzer can re-use STRUCTURE.md context when it's already on disk). Each agent receives the same base context:
- `SOURCE_ROOT`: the service's source code path
- `OUTPUT_DIR`: where to write output files
- `service-id`: the service identifier
- Safety rule: every file search/read and Bash command must be scoped to `SOURCE_ROOT` (explicit path or workdir). Never scan `/` or system mounts.

#### Agent 1: jlu-codebase-analyzer-structural (model: **sonnet**)
- **Prompt**: Read the agent definition from `<plugin-root>/agents/jlu-codebase-analyzer-structural.md`. Prepend:
  ```
  Service ID: <service-id>
  Source code path: <SOURCE_ROOT>
  Output directory: <OUTPUT_DIR>
  Safety: Scope all file operations and Bash commands to <SOURCE_ROOT>. Never scan /, /proc, /sys, /dev, /run, or home-level container storage paths.
  ```
- **Output**: `<OUTPUT_DIR>/ARCHITECTURE.md`, `<OUTPUT_DIR>/STACK.md`, `<OUTPUT_DIR>/STRUCTURE.md`

#### Agent 2: jlu-codebase-analyzer-operational (model: **sonnet**)
- **Prompt**: Read the agent definition from `<plugin-root>/agents/jlu-codebase-analyzer-operational.md`. Prepend:
  ```
  Service ID: <service-id>
  Source code path: <SOURCE_ROOT>
  Output directory: <OUTPUT_DIR>
  Safety: Scope all file operations and Bash commands to <SOURCE_ROOT>. Never scan /, /proc, /sys, /dev, /run, or home-level container storage paths.
  ```
- **Output**: `<OUTPUT_DIR>/CONVENTIONS.md`, `<OUTPUT_DIR>/INTEGRATIONS.md`, `<OUTPUT_DIR>/CONCERNS.md`
- **Note**: This agent combines automated code analysis with a user interview. It will use `question` to gather concerns not visible in the code (planned deprecations, scaling limits, tribal knowledge). See Decision #30.

**Parallel dispatch**: when `JLU_PHASE_PARALLELISM > 1`, spawn both agents in one orchestrator response (2 task tool calls). Otherwise run them sequentially. Sequential is the default — predictable local CPU/RAM beats theoretical speedup that can crash the developer's machine.

### Incremental Mode (ANALYSIS_MODE = incremental)

Spawn only the agents that have docs to update. For each agent that runs, include incremental context in the prompt:

**Base context (same as full mode):**
- `SOURCE_ROOT`, `OUTPUT_DIR`, `service-id`

**Incremental additions to the agent prompt:**
```
## Mode: Incremental Update

You are updating existing codebase analysis documents, NOT writing from scratch.

### Docs to update:
<list from STRUCTURAL_DOCS_TO_UPDATE or OPERATIONAL_DOCS_TO_UPDATE>

### Files changed since last analysis (commit <LAST_COMMIT>):
<CHANGED_FILES_STAT>

### Instructions:
- Read each existing doc you are updating FIRST.
- Review the changed files to understand what shifted.
- UPDATE the existing document: preserve sections that are still accurate, modify sections affected by changes, add new sections if changes introduce new patterns not previously documented.
- Do NOT rewrite sections unrelated to the changes.
- For docs NOT in your update list: do not touch them.
- Scope all file operations and Bash commands to `<SOURCE_ROOT>` (explicit path/workdir). Never run repository scans from `/`.
```

If only one agent needs to run, spawn only that one (not both).

---

## Step 6 — Wait for Both Agents

Both agents must complete before proceeding. If either fails:
- Report which agent failed and the error.
- Offer to retry the failed agent individually.
- Do not proceed until all 6 files exist.

**Validation check**: Verify each of the 6 output files exists and is non-empty:
- `<OUTPUT_DIR>/ARCHITECTURE.md`
- `<OUTPUT_DIR>/STACK.md`
- `<OUTPUT_DIR>/STRUCTURE.md`
- `<OUTPUT_DIR>/CONVENTIONS.md`
- `<OUTPUT_DIR>/INTEGRATIONS.md`
- `<OUTPUT_DIR>/CONCERNS.md`

---

## Step 7 — Consistency Check

Read all 6 produced files and check these contradiction classes:
- A framework or dependency has different versions in two files.
- ARCHITECTURE.md names a pattern whose required directories are absent from STRUCTURE.md.
- CONVENTIONS.md names a pattern incompatible with the architecture label (for example MVC controllers under a claimed ports-and-adapters boundary without an adapter mapping).
- INTEGRATIONS.md names a database, broker, or external system that differs from STACK.md or lacks a cited call site.
- The same domain concept uses different names across files without an alias mapping.

If inconsistencies are found, fix them directly in the affected files. No separate agent is needed.

---

### 7b. Write Analysis Marker

After all docs are verified, write the analysis marker to `<OUTPUT_DIR>/.last-analysis.json`:

```json
{
  "commit": "<current HEAD SHA from: git -C <SOURCE_ROOT> rev-parse HEAD>",
  "timestamp": "<current ISO datetime>",
  "docs_generated": [
    "ARCHITECTURE.md",
    "STACK.md",
    "STRUCTURE.md",
    "CONVENTIONS.md",
    "INTEGRATIONS.md",
    "CONCERNS.md"
  ]
}
```

---

### 7c. Ensure Registry Entry (auto-register)

> Fail-soft: if anything in this step errors, log a one-line warning, set `REGISTRY_ACTION` = `skipped (<reason>)`, and continue. Registration must never block the codebase docs deliverable.

Mapping a service is an explicit statement that it belongs to the workspace, so the registry entry is written without asking (the stack is derived from the analysis itself).

1. Read `<WORKSPACE_PATH>/registry/services.yaml`. If the file is missing, create it with an empty `services:` list.
2. If an entry with `id: <service-id>` already exists:
   - If its `path` no longer resolves to `SOURCE_ROOT`, update the `path` field and set `REGISTRY_ACTION` = `path-updated`.
   - Otherwise set `REGISTRY_ACTION` = `already-registered` and continue.
3. If no entry exists, build one:
   a. **stack**: derive from `<OUTPUT_DIR>/STACK.md` (primary framework/language), normalized to a stack name (e.g., `nestjs`, `laravel`, `react`, `nextjs`, `vue`, `angular`, `go`, `rust`). If STACK.md is ambiguous, fall back to file heuristics in `SOURCE_ROOT` (`package.json`, `composer.json`, `go.mod`, `Cargo.toml`, `nest-cli.json`, `artisan`, `next.config.*`, `angular.json`, `vite.config.*`).
   b. **path**: relative path from `WORKSPACE_PATH` to `SOURCE_ROOT` (e.g., `../service-auth`).
   c. **docker** (optional): if `docker-compose.yml`, `docker-compose.yaml`, or `compose.yml` exists in `SOURCE_ROOT`, parse its `services:` keys. If there is exactly one service, or one whose name matches the `<service-id>` stem, use it with `compose_file` set to the file's repo-relative path and `port_env: APP_PORT`. If ambiguous, omit the `docker` block and note it for the Step 9 report.
4. Append the entry to `services.yaml`:
   ```yaml
   - id: <service-id>
     path: <relative-path-from-workspace>
     stack: <derived-stack>
     docker:                    # only when unambiguously detected
       service: <compose-service-name>
       compose_file: <relative-path>
       port_env: APP_PORT
   ```
5. Set `REGISTRY_ACTION` = `registered`.
6. **Certify the `dev` block (fail-soft — nothing in this sub-step may block the docs deliverable).** After the entry is ensured — freshly registered, path-updated, or already registered — check whether it carries a `dev` block. Re-runs heal here too: an entry registered by an earlier run without a `dev` block gets one now, exactly as re-runs heal a missing registry entry. When the block is missing:
   a. **Derive** a candidate: `node <plugin-root>/bin/derive-dev-block.mjs <SOURCE_ROOT> --stack <stack>` — append `--compose-file <docker.compose_file>` when the entry already declares one, so the derivation uses the registry's compose file instead of re-discovering it.
      On exit `3` (not derivable — a library with no dev script and no compose file is the legitimate case), record `CERTIFICATION` = `exit-3(<reason>)` for the Step 9 report and continue. This is an informative note, not an error.
   b. **Persist first** (persist-then-verify): pipe the derived block JSON to
      `node <plugin-root>/bin/verify-dev-block.mjs --persist-block --workspace <WORKSPACE_PATH> --service <service-id> --block-file -` (the block JSON on stdin). Exit `5` means an mtime conflict — a concurrent writer touched `services.yaml`; re-read the registry and retry once. A second exit `5` → WARN, set `CERTIFICATION` = `skipped (persist conflict)`, continue.
   c. **Verify** with ONE dispatch of `jlu-dev-block-verifier` (subagent_type `jlu:jlu-dev-block-verifier`, bare `jlu-dev-block-verifier` fallback), passing `SERVICE_ID=<service-id>`, `WORKSPACE_PATH=<WORKSPACE_PATH>`, `CHECKOUT_PATH=<SOURCE_ROOT>` (the canonical `svc.path`), `PLUGIN_ROOT=<plugin-root>`. The verifier's only execution surface is
      `node <plugin-root>/bin/verify-dev-block.mjs --workspace <WORKSPACE_PATH> --service <service-id> --checkout <SOURCE_ROOT>` (real boot → readiness poll → launcher-specific teardown) and returns the verdict envelope. Exit codes, verdict JSON, and the envelope are defined ONCE in `jelou/references/dev-block-schema.md` → "verify-dev-block.mjs — CLI contract". The verifier never edits the registry — it reports, the orchestrator persists.
   d. `VERDICT: GREEN` with `COMMAND_EXECUTED: true` → **write the mark**:
      `node <plugin-root>/bin/verify-dev-block.mjs --write-mark --workspace <WORKSPACE_PATH> --service <service-id> --commit <short sha from COMMIT>` (same exit-`5` re-read-and-retry-once rule). The mark lands as `verified: { date, commit, block_hash }` under the `dev` block. Set `CERTIFICATION` = `derived+verified`.
   e. `VERDICT: GREEN_PREEXISTING` → NO mark: the service was already serving, so the derived command never executed — certifying a command that never ran would be theater. Set `CERTIFICATION` = `green-preexisting` and note it in the report. map-codebase NEVER stops a running dev process to force a verification — an already-serving service is left intact.
   f. `VERDICT: FAILED` or `ERROR` → NO mark; WARN with the returned `CAUSE`. The block stays persisted as an unverified hypothesis — the next `/jlu-goal` run's own boot re-verifies it. Set `CERTIFICATION` = `derived-unverified(<CAUSE>)`.

**Store**: `REGISTRY_ACTION`, `CERTIFICATION`

---

## Step 8 — Glossary Candidate Extraction (background hook)

> Fail-soft: if anything in this step errors, log a one-line warning and continue to Step 9. The 6 codebase docs are the primary deliverable; glossary candidates are a bonus.

### Precondition

If `WORKSPACE_PATH` is not resolved, skip this step entirely.

Otherwise:
- Create `<WORKSPACE_PATH>/glossary/` if missing.
- Create `<WORKSPACE_PATH>/glossary/.tmp/` if missing.

### Dispatch Extractor

Spawn a SINGLE `jlu-glossary-extractor` agent (model: `sonnet`) for the just-mapped service.

Prompt prefix:
```
service-id: <service-id>
SOURCE_ROOT: <SOURCE_ROOT>
OUTPUT_FRAGMENT: <WORKSPACE_PATH>/glossary/.tmp/<service-id>.candidates.json
EXISTING_TERMS: <union of canonical term names from UBIQUITOUS_LANGUAGE.md (if exists) and candidate names from candidates.json (if exists)>
MODE: hook
```

Followed by the full content of `<plugin-root>/agents/jlu-glossary-extractor.md`.

### Merge Fragment

After the extractor completes, run:

```bash
node <plugin-root>/bin/glossary-merge.mjs --glossary-dir <WORKSPACE_PATH>/glossary
```

If the merger fails, log a one-line warning ("Glossary merge skipped — <reason>") and continue.

### On Failure

If the extractor itself fails or never produces a fragment, log: "Glossary candidate extraction skipped — <reason>". Do NOT fail the map-codebase run.

---

## Step 9 — Report Summary

Present a final summary to the user:

```
## Map Codebase Complete — <service-id>

### Files Created
- <OUTPUT_DIR>/ARCHITECTURE.md
- <OUTPUT_DIR>/STACK.md
- <OUTPUT_DIR>/STRUCTURE.md
- <OUTPUT_DIR>/CONVENTIONS.md
- <OUTPUT_DIR>/INTEGRATIONS.md
- <OUTPUT_DIR>/CONCERNS.md

### Consistency
- Checked: <N> cross-references
- Issues found and fixed: <N>

### Registry
- <service-id>: <REGISTRY_ACTION — e.g., "registered in registry/services.yaml (stack: nestjs)", "already registered", "path updated", "skipped (<reason>)">
- Dev block: <CERTIFICATION — derived+verified | derived-unverified(<cause>) | green-preexisting | exit-3(<reason>) | already present>
- <if docker block was omitted as ambiguous: note which Compose services were found and suggest editing services.yaml>

### Glossary
- New candidate terms: <added count from Step 8 merger output, or "skipped" if Step 8 was skipped>
- Skipped: <skipped count from merger output> (already in promoted/dropped lists)
- Run `/jlu-ubiquitous-language` to curate the workspace glossary.

### Notes
- <any areas flagged for manual review>
- <any agents that required retries>
```

---

## Error Handling

| Error | Action |
|-------|--------|
| `.spec-workspace.json` not found and user declines to provide service-id | Stop with clear message |
| Workspace directory cannot be resolved or created | Stop with clear message |
| Source code root does not exist | Stop with path and suggestion |
| Research agent fails | Report failure, offer retry for that agent only |
| Registry entry write fails (Step 7c) | Log warning, report as `skipped` in summary, continue — never blocks the docs |
| Dev-block derive / persist / verify fails (Step 7c.6, B6.5, B6b) | WARN with the cause, record the certification state, continue — never blocks the docs |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| Architecture doc | `.spec-workspace/services/<service-id>/codebase/ARCHITECTURE.md` |
| Stack doc | `.spec-workspace/services/<service-id>/codebase/STACK.md` |
| Conventions doc | `.spec-workspace/services/<service-id>/codebase/CONVENTIONS.md` |
| Integrations doc | `.spec-workspace/services/<service-id>/codebase/INTEGRATIONS.md` |
| Structure doc | `.spec-workspace/services/<service-id>/codebase/STRUCTURE.md` |
| Concerns doc | `.spec-workspace/services/<service-id>/codebase/CONCERNS.md` |
| Service registry entry | `.spec-workspace/registry/services.yaml` |
