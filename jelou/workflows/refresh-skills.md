# Workflow: refresh-skills

> Orchestrator workflow for `/jlu:refresh-skills`
> Refresh the skill registry by scanning local and global skills.

---

You are the orchestrator for the `/jlu:refresh-skills` command.

## Step 1 — Scan Skill Directories

1. Scan the project-level skills directory at `.claude/skills/` (relative to the current repo root).
2. Scan the global user skills directory at `~/.claude/skills/`.
3. For each SKILL.md found, extract metadata from YAML frontmatter:
   - `name`
   - `description`
   - `allowed-tools` (used to infer capabilities)

## Step 2 — Build Registry

1. Construct a `skill-registry.json` with the following schema per skill:
   ```json
   {
     "skills": [
       {
         "name": "<skill-name>",
         "description": "<one-line description>",
         "origin": "project" | "global",
         "path": "<relative path to SKILL.md>",
         "capabilities": ["<inferred from allowed-tools and description>"]
       }
     ],
     "lastRefreshed": "<ISO 8601 timestamp>"
   }
   ```
2. Apply precedence: project skills override global skills with the same name.

## Step 3 — Write Registry

1. Write the registry to `.claude/skill-registry.json` in the current repo.

## Step 4 — Report

1. Report what was found:
   - Total skills discovered (project vs global)
   - Any name collisions (project overrides global)
   - Skills added or removed since last refresh (if a previous registry exists)
   - Timestamp of the refresh
