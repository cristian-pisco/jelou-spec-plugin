# Workflow: map-codebase

> Orchestrator workflow for `/jlu:map-codebase [service-id]`
> Maps a service's codebase using 2 parallel research agents.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST use `AskUserQuestion`. Never output questions as plain text.

---

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
   - Use the current working directory as the source root.
2. If the `service-id` was provided as an argument (and we might not be in the service repo):
   a. Read `<WORKSPACE_PATH>/registry/services.yaml`.
   b. Find the entry matching the `service-id`.
   c. Resolve the `path` field relative to the workspace directory.
   d. Verify the path exists.
3. If the source root cannot be determined:
   - Ask the user: "Where is the source code for `<service-id>`? Provide the absolute or relative path."

**Store**: `SOURCE_ROOT` = absolute path to the service's source code.

**Error gate**: If the source root does not exist or is empty, stop and report the error.

---

## Step 5 — Spawn 2 Research Agents in Parallel

Spawn both agents simultaneously using the Agent tool. Each agent receives the same base context:
- `SOURCE_ROOT`: the service's source code path
- `OUTPUT_DIR`: where to write output files
- `service-id`: the service identifier

### Agent 1: jlu-codebase-analyzer-structural (model: **sonnet**)
- **Prompt**: Read the agent definition from `<plugin-root>/agents/jlu-codebase-analyzer-structural.md`. Prepend:
  ```
  Service ID: <service-id>
  Source code path: <SOURCE_ROOT>
  Output directory: <OUTPUT_DIR>
  ```
- **Output**: `<OUTPUT_DIR>/ARCHITECTURE.md`, `<OUTPUT_DIR>/STACK.md`, `<OUTPUT_DIR>/STRUCTURE.md`

### Agent 2: jlu-codebase-analyzer-operational (model: **sonnet**)
- **Prompt**: Read the agent definition from `<plugin-root>/agents/jlu-codebase-analyzer-operational.md`. Prepend:
  ```
  Service ID: <service-id>
  Source code path: <SOURCE_ROOT>
  Output directory: <OUTPUT_DIR>
  ```
- **Output**: `<OUTPUT_DIR>/CONVENTIONS.md`, `<OUTPUT_DIR>/INTEGRATIONS.md`, `<OUTPUT_DIR>/CONCERNS.md`
- **Note**: This agent combines automated code analysis with a user interview. It will use `AskUserQuestion` to gather concerns not visible in the code (planned deprecations, scaling limits, tribal knowledge). See Decision #30.

**Important**: Both agents MUST be spawned in parallel (2 separate Agent tool calls in a single response).

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

Read all 6 produced files. Do a quick inline scan for obvious inconsistencies:
- Different framework versions mentioned across files
- Contradictory architecture claims (e.g., ARCHITECTURE.md says "hexagonal" but CONVENTIONS.md describes MVC patterns)
- Inconsistent terminology or naming between files
- Factual discrepancies (e.g., different database engines referenced)

If inconsistencies are found, fix them directly in the affected files. No separate agent is needed.

---

## Step 8 — Report Summary

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
