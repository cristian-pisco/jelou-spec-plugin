# Docker Compose Project Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `name: <service-id>-<TASK_SLUG>` to generated `docker-compose.override.yml` files to prevent Docker Compose project name collisions between worktrees.

**Architecture:** Add `name` as a top-level key in the override template and update all YAML examples across three documentation files.

**Tech Stack:** Markdown documentation

---

## File Structure

| File | Responsibility |
|------|---------------|
| `jelou/references/docker-conventions.md` | Reference doc — override generation rules and examples |
| `jelou/workflows/new-task.md` | Workflow — Phase 3 override generation steps |
| `docs/superpowers/specs/2026-03-24-worktree-docker-isolation-design.md` | Design spec — override examples |

---

### Task 1: Add `name` to `docker-conventions.md`

**Files:**
- Modify: `jelou/references/docker-conventions.md:49-98`

- [ ] **Step 1: Add `name` to the Override Generation bullet list**

Insert a new bullet at line 53, before the existing `container_name` bullet:

```markdown
- **`name`**: `<service-id>-<TASK_SLUG>` (sets the Docker Compose project name, preventing cross-service collisions)
```

- [ ] **Step 2: Add `name` to the first YAML example (marketplace-service)**

Inside the code block starting at line 61, add `name: marketplace-service-add-oauth-flow` before `services:` (line 62):

```yaml
name: marketplace-service-add-oauth-flow

services:
  app:
    container_name: marketplace-service-add-oauth-flow
    ports:
      - "3100:8080"
    networks:
      app-network:
        aliases:
          - marketplace-service-add-oauth-flow
```

- [ ] **Step 3: Add `name` to the second YAML example (orchestrator-service)**

Inside the code block starting at line 84, add `name: orchestrator-service-add-oauth-flow` before `services:` (line 85):

```yaml
name: orchestrator-service-add-oauth-flow

services:
  app:
    container_name: orchestrator-service-add-oauth-flow
    ports:
      - "3101:8080"
    networks:
      app-network:
        aliases:
          - orchestrator-service-add-oauth-flow
  router-vector-db:
    container_name: router-vector-db-add-oauth-flow
    ports:
      - "5433:5432"
```

- [ ] **Step 4: Verify the file reads correctly**

Read `jelou/references/docker-conventions.md` and confirm the Override Generation section now lists `name` first, and both YAML examples include the `name` top-level key.

- [ ] **Step 5: Commit**

```bash
git add jelou/references/docker-conventions.md
git commit -m "Add project name to docker-compose override conventions"
```

---

### Task 2: Add `name` to Phase 3 in `new-task.md`

**Files:**
- Modify: `jelou/workflows/new-task.md:256-264`

- [ ] **Step 1: Add `name` to the override generation list**

At line 257, after "Generate `<worktree>/docker-compose.override.yml` with:", add a new bullet before the primary container block:

```markdown
   - Top-level `name: <service-id>-<TASK_SLUG>` (sets Docker Compose project name)
```

The full block should read:

```markdown
2. Generate `<worktree>/docker-compose.override.yml` with:
   - Top-level `name: <service-id>-<TASK_SLUG>` (sets Docker Compose project name)
   - For the primary container (`docker.service` from `services.yaml`):
     - `container_name: <service-id>-<TASK_SLUG>`
     - `ports: ["<allocated-port>:<internal-port>"]`
     - `networks.app-network.aliases: [<service-id>-<TASK_SLUG>]`
   - For each secondary container:
     - `container_name: <original-container-name>-<TASK_SLUG>`
     - `ports: ["<allocated-port>:<internal-port>"]`
```

- [ ] **Step 2: Verify the edit**

Read `jelou/workflows/new-task.md` lines 252-267 and confirm Phase 3 now includes `name`.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/new-task.md
git commit -m "Add project name to Phase 3 override generation in new-task workflow"
```

---

### Task 3: Add `name` to worktree-docker-isolation design spec

**Files:**
- Modify: `docs/superpowers/specs/2026-03-24-worktree-docker-isolation-design.md:47-83`

- [ ] **Step 1: Add `name` to the prose bullet list**

Insert a new bullet at line 49, before the existing `container_name` bullet (line 49):

```markdown
- **`name`**: `<service-id>-<TASK_SLUG>` (sets the Docker Compose project name)
```

- [ ] **Step 2: Add `name` to the first YAML example**

Inside the code block starting at line 55, add `name: marketplace-service-add-oauth-flow` before `services:` (line 56):

```yaml
name: marketplace-service-add-oauth-flow

services:
  app:
    container_name: marketplace-service-add-oauth-flow
    ports:
      - "3100:8080"
    networks:
      app-network:
        aliases:
          - marketplace-service-add-oauth-flow
```

- [ ] **Step 3: Add `name` to the second YAML example**

Inside the code block starting at line 69, add `name: orchestrator-service-add-oauth-flow` before `services:` (line 70):

```yaml
name: orchestrator-service-add-oauth-flow

services:
  app:
    container_name: orchestrator-service-add-oauth-flow
    ports:
      - "3101:8080"
    networks:
      app-network:
        aliases:
          - orchestrator-service-add-oauth-flow
  router-vector-db:
    container_name: router-vector-db-add-oauth-flow
    ports:
      - "5433:5432"
```

- [ ] **Step 4: Verify the file reads correctly**

Read `docs/superpowers/specs/2026-03-24-worktree-docker-isolation-design.md` lines 45-90 and confirm the prose list and both YAML examples now include `name`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-03-24-worktree-docker-isolation-design.md
git commit -m "Add project name to override examples in isolation design spec"
```
