# Workflow: map-codebase

> Orchestrator workflow for `/jlu:map-codebase [service-id]`
> Maps a service's codebase using 6 parallel research agents + cross-validation.

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

## Step 5 — Spawn 6 Research Agents in Parallel

Spawn all 6 agents simultaneously using the Agent tool. Each agent receives the same base context:
- `SOURCE_ROOT`: the service's source code path
- `OUTPUT_DIR`: where to write the output file
- `service-id`: the service identifier

### Agent 1: jlu-architecture-researcher
- **Prompt**: Read the agent definition from `<plugin-root>/agents/jlu-architecture-researcher.md`. Prepend:
  ```
  Service ID: <service-id>
  Source code path: <SOURCE_ROOT>
  Output file: <OUTPUT_DIR>/ARCHITECTURE.md
  ```
- **Output**: `<OUTPUT_DIR>/ARCHITECTURE.md`

### Agent 2: jlu-stack-researcher
- **Prompt**: Read the agent definition from `<plugin-root>/agents/jlu-stack-researcher.md`. Prepend:
  ```
  Service ID: <service-id>
  Source code path: <SOURCE_ROOT>
  Output file: <OUTPUT_DIR>/STACK.md
  ```
- **Output**: `<OUTPUT_DIR>/STACK.md`

### Agent 3: jlu-conventions-researcher
- **Prompt**: Read the agent definition from `<plugin-root>/agents/jlu-conventions-researcher.md`. Prepend:
  ```
  Service ID: <service-id>
  Source code path: <SOURCE_ROOT>
  Output file: <OUTPUT_DIR>/CONVENTIONS.md
  ```
- **Output**: `<OUTPUT_DIR>/CONVENTIONS.md`

### Agent 4: jlu-integrations-researcher
- **Prompt**: Read the agent definition from `<plugin-root>/agents/jlu-integrations-researcher.md`. Prepend:
  ```
  Service ID: <service-id>
  Source code path: <SOURCE_ROOT>
  Output file: <OUTPUT_DIR>/INTEGRATIONS.md
  ```
- **Output**: `<OUTPUT_DIR>/INTEGRATIONS.md`

### Agent 5: jlu-structure-researcher
- **Prompt**: Read the agent definition from `<plugin-root>/agents/jlu-structure-researcher.md`. Prepend:
  ```
  Service ID: <service-id>
  Source code path: <SOURCE_ROOT>
  Output file: <OUTPUT_DIR>/STRUCTURE.md
  ```
- **Output**: `<OUTPUT_DIR>/STRUCTURE.md`

### Agent 6: jlu-concerns-researcher
- **Prompt**: Read the agent definition from `<plugin-root>/agents/jlu-concerns-researcher.md`. Prepend:
  ```
  Service ID: <service-id>
  Source code path: <SOURCE_ROOT>
  Output file: <OUTPUT_DIR>/CONCERNS.md
  ```
- **Output**: `<OUTPUT_DIR>/CONCERNS.md`
- **Note**: This agent combines automated code analysis (TODOs, vulnerability patterns, test coverage gaps, deprecated deps) with a user interview. It will use `AskUserQuestion` to ask about known concerns not visible in the code (planned deprecations, scaling limits, tribal knowledge). See Decision #30.

**Important**: All 6 agents MUST be spawned in parallel (do not wait for one before spawning the next). Use 6 separate Agent tool calls in a single response.

---

## Step 6 — Wait for All Agents

All 6 agents must complete before proceeding. If any agent fails:
- Report which agent failed and the error.
- Offer to retry the failed agent(s) individually.
- Do not proceed to cross-validation until all 6 files exist.

**Validation check**: Verify each of the 6 output files exists and is non-empty:
- `<OUTPUT_DIR>/ARCHITECTURE.md`
- `<OUTPUT_DIR>/STACK.md`
- `<OUTPUT_DIR>/CONVENTIONS.md`
- `<OUTPUT_DIR>/INTEGRATIONS.md`
- `<OUTPUT_DIR>/STRUCTURE.md`
- `<OUTPUT_DIR>/CONCERNS.md`

---

## Step 7 — Cross-Validation

Spawn the `jlu-cross-validator` agent:

- **Prompt**: Read the agent definition from `<plugin-root>/agents/jlu-cross-validator.md`. Prepend the contents of all 6 codebase files:
  ```
  Service ID: <service-id>

  === ARCHITECTURE.md ===
  <contents of ARCHITECTURE.md>

  === STACK.md ===
  <contents of STACK.md>

  === CONVENTIONS.md ===
  <contents of CONVENTIONS.md>

  === INTEGRATIONS.md ===
  <contents of INTEGRATIONS.md>

  === STRUCTURE.md ===
  <contents of STRUCTURE.md>

  === CONCERNS.md ===
  <contents of CONCERNS.md>
  ```
- **Task**: The agent reads all 6 files and identifies:
  - Contradictions between files (e.g., ARCHITECTURE.md says "hexagonal" but CONVENTIONS.md references MVC patterns)
  - Inconsistencies in terminology or naming
  - Gaps where one file references something another file should cover but does not
  - Factual discrepancies (e.g., different framework versions mentioned)
- **Output**: A structured list of findings, each with:
  - Which files are involved
  - What the contradiction/inconsistency is
  - A suggested resolution

---

## Step 8 — Present Cross-Validation Results

1. If the cross-validator found **no contradictions**:
   - Report: "Cross-validation passed. No contradictions found across the 6 codebase files."
   - Skip to Step 9.

2. If contradictions **were found**:
   - Present each contradiction to the user, one at a time:
     ```
     **Contradiction #<N>**
     - Files: <file1> vs <file2>
     - Issue: <description>
     - Suggested resolution: <suggestion>

     How would you like to resolve this? (Accept suggestion / Provide your own / Skip)
     ```
   - For each resolution:
     - If "Accept suggestion": Apply the correction to the affected file(s).
     - If "Provide your own": Apply the user's correction to the affected file(s).
     - If "Skip": Leave as-is and note it in the report.

---

## Step 9 — Report Summary

Present a final summary to the user:

```
## Map Codebase Complete — <service-id>

### Files Created
- <OUTPUT_DIR>/ARCHITECTURE.md
- <OUTPUT_DIR>/STACK.md
- <OUTPUT_DIR>/CONVENTIONS.md
- <OUTPUT_DIR>/INTEGRATIONS.md
- <OUTPUT_DIR>/STRUCTURE.md
- <OUTPUT_DIR>/CONCERNS.md

### Cross-Validation
- Contradictions found: <N>
- Resolved: <N>
- Skipped: <N>

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
| Individual research agent fails | Report failure, offer retry for that agent only |
| Cross-validator agent fails | Report failure, note that cross-validation was skipped |
| User cancels during contradiction resolution | Save progress so far, report partial resolution |

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
