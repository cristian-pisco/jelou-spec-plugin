# Workflow: new-project

> Orchestrator workflow for `/jlu:new-project`
> Greenfield bootstrap: interview, scaffold, Docker, git, workspace registration, codebase mapping.

---

## Step 1 — Verify Running Directory

1. Confirm the orchestrator is running from the **parent directory** where the new project will be created.
   - The new project directory will be created as a subdirectory of the current working directory.
2. Ask: "You are in `<current-directory>`. The new project will be created here as a subdirectory. Correct?"
   - If the user says no: ask for the correct parent path, or instruct them to navigate there first.

**Store**: `PARENT_DIR` = current working directory (or user-provided path)

---

## Step 2 — Ask for Project Name

Ask the user:
> "What is the project name? (This will be the directory name — lowercase, hyphens allowed)"

Validate:
- Lowercase letters, numbers, and hyphens only.
- No leading or trailing hyphens.
- No spaces or special characters.
- The directory `<PARENT_DIR>/<project-name>` must NOT already exist.

If validation fails, explain the issue and ask again.

**Store**: `PROJECT_NAME`

---

## Step 3 — Tiered Interview (Decision #45)

Ask the user to choose interview depth:
```
Setup mode:
1. Quick setup — Stack, database, Docker (3-4 questions)
2. Extended setup — Full configuration: auth, API style, CI/CD, linting, and more (8-12 questions)

Choose (1/2):
```

**Store**: `INTERVIEW_MODE` = `quick` or `extended`

### Quick Mode Questions

#### Q1: Archetype
```
Project archetype:
1. Backend — API service, worker, or server
2. Frontend — Web application or SPA
3. Fullstack — Backend + frontend in one project

Choose (1/2/3):
```
**Store**: `ARCHETYPE`

#### Q2: Stack Selection

Present stacks based on archetype:

**Backend**:
```
Backend stack:
1. NestJS (TypeScript)
2. Laravel (PHP)
3. Go
4. Rust

Choose:
```

**Frontend**:
```
Frontend stack:
1. React (Vite)
2. Next.js
3. Vue.js (Vite)
4. Angular
5. TanStack Start

Choose:
```

**Fullstack**: Ask for both backend and frontend stacks separately using the lists above.

**Store**: `STACK` (or `BACKEND_STACK` + `FRONTEND_STACK` for fullstack)

#### Q3: Database (Backend and Fullstack only)
```
Database:
1. PostgreSQL
2. MySQL / MariaDB
3. MongoDB
4. SQLite (dev only)
5. None (no database)

Choose:
```
**Store**: `DATABASE`

#### Q4: Cache (Optional, Backend and Fullstack only)
```
Cache system:
1. Redis
2. Memcached
3. None

Choose (default: None):
```
**Store**: `CACHE`

### Extended Mode Additional Questions

All quick mode questions above, PLUS:

#### Q5: Authentication Strategy
```
Authentication:
1. JWT (stateless)
2. Session-based
3. OAuth2 / Social login
4. API keys only
5. None / will add later

Choose:
```
**Store**: `AUTH_STRATEGY`

#### Q6: API Style (Backend and Fullstack only)
```
API style:
1. REST
2. GraphQL
3. gRPC
4. Hybrid (REST + GraphQL)

Choose:
```
**Store**: `API_STYLE`

#### Q7: CI/CD Pipeline
```
CI/CD:
1. GitHub Actions
2. GitLab CI
3. None / will configure later

Choose:
```
**Store**: `CICD`

#### Q8: Linting and Formatting
```
Linting/Formatting:
1. ESLint + Prettier (JS/TS projects)
2. PHP CS Fixer (Laravel)
3. golangci-lint (Go)
4. clippy + rustfmt (Rust)
5. Auto-detect from stack
6. None

Choose (default: auto-detect):
```
**Store**: `LINTING`

#### Q9: Git Hooks
```
Git hooks:
1. Husky + lint-staged (JS/TS)
2. Pre-commit framework
3. None

Choose:
```
**Store**: `GIT_HOOKS`

#### Q10: Environment Management
```
Environment management:
1. dotenv (.env files)
2. direnv
3. Docker-only (env in compose)
4. Framework default

Choose:
```
**Store**: `ENV_MANAGEMENT`

#### Q11: Queue / Messaging (Backend and Fullstack only)
```
Queue/messaging system:
1. Redis (Bull/BullMQ)
2. RabbitMQ
3. AWS SQS
4. None

Choose (default: None):
```
**Store**: `QUEUE_SYSTEM`

---

## Step 4 — Present Bootstrap Plan

Compile all interview answers into a bootstrap plan and present for confirmation:

```
## Bootstrap Plan — <PROJECT_NAME>

### Archetype: <archetype>
### Stack: <stack(s)>

### Infrastructure
- Database: <database>
- Cache: <cache>
- Queue: <queue> (extended only)

### Configuration (extended only)
- Auth: <auth_strategy>
- API style: <api_style>
- CI/CD: <cicd>
- Linting: <linting>
- Git hooks: <git_hooks>
- Env management: <env_management>

### Docker (mandatory)
- Dockerfile.dev
- Dockerfile.prod
- docker-compose.yml (with DB, cache, queue services as applicable)

### Layout
<if backend or frontend>
Natural stack structure (no artificial backend/ or frontend/ folders)
<if fullstack>
Explicit layout: <PROJECT_NAME>/backend/ + <PROJECT_NAME>/frontend/

Proceed with this plan? (yes / adjust)
```

If the user wants adjustments, go back to the relevant question and re-ask.

---

## Step 5 — Create Project Directory

1. Create the project root: `<PARENT_DIR>/<PROJECT_NAME>/`
2. Based on archetype:

### Backend or Frontend (pure)
Create the natural stack structure. Do NOT create artificial `backend/` or `frontend/` wrapper directories.

### Fullstack
Create the explicit layout:
```
<PROJECT_NAME>/
  backend/
  frontend/
```

---

## Step 6 — Apply Stack Template (Decision #34)

Start from a curated template for the selected stack, then customize based on interview answers.

### 6a. Base Template

Spawn a `jlu-scaffold-agent` (model: sonnet) for the stack setup:
- **Input**: All interview answers, project name, target directory.
- **Task**: Generate the base project structure following the stack's idiomatic conventions.
  - For NestJS: use `nest new` patterns (or reproduce the structure).
  - For Laravel: use Laravel's default structure.
  - For Go: use the plugin's opinionated layout.
  - For Rust: use the plugin's opinionated layout.
  - For React/Vue/Angular/Next.js/TanStack: use Vite or framework CLI patterns.
- **Layout policy**:
  - Laravel and NestJS: keep native layout.
  - Go and Rust: use the plugin's opinionated layout.

### 6b. Customization (Extended Mode)

If `INTERVIEW_MODE` is `extended`, the scaffold agent also:
- Configures authentication boilerplate based on `AUTH_STRATEGY`.
- Sets up API style routing based on `API_STYLE`.
- Creates CI/CD pipeline files based on `CICD`.
- Configures linting and formatting based on `LINTING`.
- Sets up git hooks based on `GIT_HOOKS`.
- Configures environment management based on `ENV_MANAGEMENT`.
- Sets up queue/messaging infrastructure based on `QUEUE_SYSTEM`.

---

## Step 7 — Create Docker Files (Mandatory)

For every new project, create:

### Dockerfile.dev
- Based on the stack's runtime (Node, PHP, Go, Rust).
- Optimized for development: hot reload, volume mounts, debug tools.
- Multi-stage if appropriate.

### Dockerfile.prod
- Based on the stack's runtime.
- Optimized for production: minimal image, no dev dependencies, non-root user.
- Multi-stage build.

### docker-compose.yml
- Service for the application.
- Services for infrastructure based on interview answers:
  - Database service (if selected): correct image and version for the chosen engine.
  - Cache service (if selected): Redis or Memcached.
  - Queue service (if selected): RabbitMQ, Redis, etc.
- Volume mounts for development.
- Network configuration.
- Environment variable mapping.

For fullstack projects: both backend and frontend services in the same compose file.

---

## Step 8 — Initialize Git Repository

1. Navigate to the project directory.
2. Run:
   ```bash
   cd <PARENT_DIR>/<PROJECT_NAME> && git init
   ```
3. Create a `.gitignore` appropriate for the selected stack.
4. Create an initial commit:
   ```bash
   git add -A && git commit -m "chore: initial project scaffold"
   ```

---

## Step 9 — Create .spec-workspace.json

Create `<PARENT_DIR>/<PROJECT_NAME>/.spec-workspace.json`:

```json
{
  "workspace": "../.spec-workspace",
  "serviceId": "<PROJECT_NAME>"
}
```

For fullstack projects, consider whether to register as one service or two:
- Ask user: "Register as one service (`<PROJECT_NAME>`) or two (`<PROJECT_NAME>-backend` + `<PROJECT_NAME>-frontend`)?"
- Create `.spec-workspace.json` accordingly (one file at project root, or one per sub-project).

---

## Step 10 — Initialize or Update .spec-workspace

### 10a. Check for Existing Workspace

1. Check if `<PARENT_DIR>/.spec-workspace/` already exists.
2. If it exists: use it. Read `registry/services.yaml`.
3. If it does NOT exist: create the full base structure:
   ```
   <PARENT_DIR>/.spec-workspace/
     registry/
       services.yaml
     principles/
       ENGINEERING_PRINCIPLES.md
     services/
     specs/
   ```

### 10b. Register Service

Add the new project to `services.yaml`:

```yaml
- id: <PROJECT_NAME>
  path: ../<PROJECT_NAME>
  stack: <STACK>
```

For fullstack with two services:
```yaml
- id: <PROJECT_NAME>-backend
  path: ../<PROJECT_NAME>/backend
  stack: <BACKEND_STACK>

- id: <PROJECT_NAME>-frontend
  path: ../<PROJECT_NAME>/frontend
  stack: <FRONTEND_STACK>
```

### 10c. Create Engineering Principles (if not exists)

If `<PARENT_DIR>/.spec-workspace/principles/ENGINEERING_PRINCIPLES.md` does not exist, create it with the default template:

Copy from the template at `jelou/templates/engineering-principles.md`.

---

## Step 11 — Run Map Codebase

1. Invoke `/jlu:map-codebase` on the newly created project.
   - For single-service: run once with the project's service-id.
   - For fullstack with two services: run for each sub-service.
2. This generates the 6 codebase files under `.spec-workspace/services/<service-id>/codebase/`.

Note: Since the project is brand new and scaffolded, the codebase map will document the template structure. This is still valuable as a baseline for future reference.

---

## Step 12 — Report

Present the final summary:

```
## Project Created — <PROJECT_NAME>

### Location
<PARENT_DIR>/<PROJECT_NAME>/

### Configuration
- Archetype: <archetype>
- Stack: <stack(s)>
- Database: <database>
- Cache: <cache>
- Docker: Dockerfile.dev + Dockerfile.prod + docker-compose.yml
<if extended>
- Auth: <auth_strategy>
- API style: <api_style>
- CI/CD: <cicd>
- Linting: <linting>
- Git hooks: <git_hooks>
- Env management: <env_management>
- Queue: <queue_system>

### Workspace
- .spec-workspace.json: <PROJECT_NAME>/.spec-workspace.json
- Registered in: <PARENT_DIR>/.spec-workspace/registry/services.yaml
- Codebase mapped: .spec-workspace/services/<service-id>/codebase/

### Git
- Repository initialized
- Initial commit created
- Branch: main

### Next Steps
1. Review the generated project structure
2. Run `docker compose up` to verify the dev environment
3. Create your first task with `/jlu:new-task`
```

---

## Error Handling

| Error | Action |
|-------|--------|
| Project directory already exists | Stop, ask user to choose a different name |
| Parent directory is not writable | Stop with permission error |
| Invalid project name | Explain validation rules, ask again |
| Git init fails | Report error, continue without git (project files still created) |
| Docker file generation fails | Report error, note that Docker needs manual setup |
| Scaffold agent fails | Report error, offer to retry or create minimal structure |
| Map codebase fails | Report error, note it can be run later manually |
| services.yaml write fails | Report error, provide manual registration instructions |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| Project root | `<PARENT_DIR>/<PROJECT_NAME>/` |
| Workspace pointer | `<PROJECT_NAME>/.spec-workspace.json` |
| Dockerfile.dev | `<PROJECT_NAME>/Dockerfile.dev` |
| Dockerfile.prod | `<PROJECT_NAME>/Dockerfile.prod` |
| docker-compose.yml | `<PROJECT_NAME>/docker-compose.yml` |
| .gitignore | `<PROJECT_NAME>/.gitignore` |
| Service registry | `.spec-workspace/registry/services.yaml` |
| Engineering principles | `.spec-workspace/principles/ENGINEERING_PRINCIPLES.md` |
| Codebase map | `.spec-workspace/services/<service-id>/codebase/*.md` |

---

## Decision References

| Decision | Application |
|----------|-------------|
| #34 | Template + agent customization for scaffolding |
| #45 | Tiered interview: quick (stack/DB/Docker) vs extended (full config) |
