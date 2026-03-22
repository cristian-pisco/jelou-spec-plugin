# Worktree Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure all post-execution sessions (load-context and beyond) resolve service paths through task worktrees instead of main repos.

**Architecture:** Extract the worktree resolution algorithm from execute-task Step 7c into a shared reference block (`jelou/references/worktree-resolution.md`). Integrate it into load-context as a new step. Refactor execute-task to reference the shared block.

**Tech Stack:** Markdown skill/workflow files (no code — this is a prompt engineering change)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `jelou/references/worktree-resolution.md` | Create | Reusable worktree resolution algorithm, output format, and directive |
| `skills/load-context/SKILL.md` | Modify | Add worktree resolution step, update context block and closing message |
| `jelou/workflows/execute-task.md` | Modify | Replace inline resolution in Step 7c with reference to shared block |

**Note:** The canonical source for `skills/load-context/SKILL.md` in this repo is at the project root. The installed copy at `~/.claude/plugins/marketplaces/jelou-spec-plugin/skills/load-context/SKILL.md` is a cache — edits go to the source.

---

### Task 1: Create the worktree resolution reference block

**Files:**
- Create: `jelou/references/worktree-resolution.md`

- [ ] **Step 1: Create the reference file**

Write `jelou/references/worktree-resolution.md` with this content:

```markdown
# Worktree Resolution

> Resolves the correct source path (worktree or main repo) for each affected service in a task. Used by any workflow or skill that needs to read or modify service code in the context of a task.

## Resolution Algorithm

For each affected service:

1. Look up the service entry in `<WORKSPACE_PATH>/registry/services.yaml`.
2. Resolve the absolute repo path: `<WORKSPACE_PATH>/` + `service.path`.
3. Check if the task worktree exists: `<service-repo>/.worktrees/<TASK_SLUG>/`
4. If the worktree directory exists → `SERVICE_SOURCE_PATH` = the worktree path.
5. If the worktree does not exist → `SERVICE_SOURCE_PATH` = the service repo root. Log a warning: "No worktree found for `<service-id>` — using main repo."

If TASKS.md lists a service that is not in `services.yaml`, skip it with a warning: "Service `<service-id>` not found in registry — skipping worktree resolution."

## Output: Worktree Map

Present the resolved paths as a table:

### Active Worktrees

| Service | Source Path | Type |
|---------|------------|------|
| `<service-id>` | `<resolved-absolute-path>` | worktree |
| `<service-id>` | `<resolved-absolute-path>` | main repo (no worktree) |

## Directive

After presenting the Worktree Map, include this instruction:

> **IMPORTANT**: When reading or modifying files for any affected service, you MUST use the Source Path from the Worktree Map above — never the main repository path. This ensures changes land in the correct task-isolated directory.
```

- [ ] **Step 2: Verify the file exists and matches the reference pattern**

Run: `ls -la jelou/references/worktree-resolution.md`
Expected: File exists.

Run: `head -1 jelou/references/worktree-resolution.md`
Expected: `# Worktree Resolution`

- [ ] **Step 3: Commit**

```bash
git add jelou/references/worktree-resolution.md
git commit -m "Add worktree resolution reference block"
```

---

### Task 2: Integrate worktree resolution into load-context

**Files:**
- Modify: `skills/load-context/SKILL.md` (lines 76-161)

This task adds a new Step 7, renumbers old Steps 7-8 to 8-9, and updates the context output format and closing message.

- [ ] **Step 1: Add new Step 7 — Resolve Worktree Map**

Insert after the current Step 6 (line 100, after the blockers override) and before the current Step 7 ("Present Context Block"). The new step:

```markdown
## Step 7 — Resolve Worktree Map

Resolve the correct source paths for all affected services so the assistant uses worktree paths (not main repo paths) when the user requests changes.

1. Read `<WORKSPACE_PATH>/registry/services.yaml`.
2. Extract the list of affected services from the TASKS.md loaded in Step 3 (the "Services" field in the Metadata section). If TASKS.md does not list affected services, extract them from SPEC.md or PROPOSAL.md instead.
3. For each affected service, apply the worktree resolution algorithm from `references/worktree-resolution.md`:
   a. Resolve the absolute repo path from `services.yaml`.
   b. Check if `<service-repo>/.worktrees/<TASK_SLUG>/` exists (using the task slug from Step 1).
   c. If it exists: record the worktree path as the service's source path.
   d. If not: record the main repo path and log a warning.
4. Store the Worktree Map for use in Step 8.
```

- [ ] **Step 2: Renumber old Step 7 → Step 8 ("Present Context Block")**

Change the heading from `## Step 7 — Present Context Block` to `## Step 8 — Present Context Block`.

- [ ] **Step 3: Insert Worktree Map section into the context block output**

In the context block template (inside the newly renumbered Step 8), insert the Worktree Map section right after the `**Branch**: ... | **Date**: ...` line and before `### Loaded Artifacts`. Add:

```markdown
---

### Active Worktrees

| Service | Source Path | Type |
|---------|------------|------|
| `<service-id>` | `<resolved-path>` | worktree or main repo |

> **IMPORTANT**: When reading or modifying files for any affected service, you MUST use the Source Path from the Worktree Map above — never the main repository path. This ensures changes land in the correct task-isolated directory.
```

- [ ] **Step 4: Renumber old Step 8 → Step 9 ("Task Summary")**

Change the heading from `## Step 8 — Task Summary` to `## Step 9 — Task Summary`.

- [ ] **Step 5: Update the closing message**

In the newly renumbered Step 9, change the closing message from:

```
> Context loaded. You can ask me anything about this task. I can read any artifact from the inventory above for more detail.
```

To:

```
> Context loaded. You can ask me anything about this task. When making changes, I'll use the worktree paths shown above. I can read any artifact from the inventory for more detail.
```

- [ ] **Step 6: Verify the step numbering is consistent**

Read the full file and confirm:
- Steps are numbered 1 through 9 with no gaps or duplicates.
- References within steps (e.g., "loaded in Step 3", "from Step 1") still point to the correct steps.

- [ ] **Step 7: Commit**

```bash
git add skills/load-context/SKILL.md
git commit -m "Add worktree resolution step to load-context"
```

---

### Task 3: Refactor execute-task Step 7c to reference the shared block

**Files:**
- Modify: `jelou/workflows/execute-task.md` (lines 236-251)

- [ ] **Step 1: Replace the inline worktree resolution with a reference**

Replace the current Step 7c content (lines 236-251) with:

```markdown
### 7c. Resolve Service Source Path and Docker Context

1. Apply the worktree resolution algorithm from `references/worktree-resolution.md` for the current service:
   - Look up the service entry in `services.yaml`.
   - Check if `<service-repo>/.worktrees/<TASK_SLUG>` exists.
   - If yes: use the worktree as `SERVICE_SOURCE_PATH`.
   - If no: fall back to the service's main repo path from `services.yaml`.
2. **Docker context resolution** — Read the service's `docker` config from `services.yaml`:
   a. If the service has a `docker` block:
      1. Check container status: `cd <SERVICE_SOURCE_PATH> && docker compose ps --format '{{.State}}'`
      2. If not running, restart: `cd <SERVICE_SOURCE_PATH> && docker compose up -d`
      3. Compute `DOCKER_EXEC_PREFIX` = `cd <SERVICE_SOURCE_PATH> && docker compose exec <docker.service>`
      4. Set `IS_DOCKER_SERVICE` = `true`
   b. If no `docker` block:
      1. Set `DOCKER_EXEC_PREFIX` = empty
      2. Set `IS_DOCKER_SERVICE` = `false`

**Store**: `SERVICE_SOURCE_PATH`, `DOCKER_EXEC_PREFIX`, `IS_DOCKER_SERVICE`
```

- [ ] **Step 2: Verify the Docker context still references SERVICE_SOURCE_PATH correctly**

Read the modified Step 7c and confirm:
- Docker commands use `<SERVICE_SOURCE_PATH>` (not the old `<worktree>` variable).
- The Store line is unchanged.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/execute-task.md
git commit -m "Refactor execute-task Step 7c to use shared worktree resolution reference"
```

---

### Task 4: Verify consistency across all three files

- [ ] **Step 1: Grep for stale worktree resolution patterns in execute-task**

Run: `grep -n "Look up the service's worktree path" jelou/workflows/execute-task.md`
Expected: No matches (the old inline phrasing should be gone).

- [ ] **Step 2: Verify the reference file is mentioned in both consumers**

Run: `grep -rn "worktree-resolution.md" jelou/ skills/`
Expected: Two matches — one in `jelou/workflows/execute-task.md`, one in `skills/load-context/SKILL.md`.

- [ ] **Step 3: Verify load-context step count**

Run: `grep -c "^## Step" skills/load-context/SKILL.md`
Expected: `9` (was 8, now 9 with the new Worktree Map step).

- [ ] **Step 4: Read the full load-context SKILL.md end-to-end**

Confirm: step numbering is 1-9, no gaps, no duplicates, internal cross-references are correct.
