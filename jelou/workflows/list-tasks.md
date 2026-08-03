# Workflow: list-tasks

> Orchestrator workflow for `/jlu-list-tasks [--status <state>] [--sprint <n>]`
> Lists every local task created by `/jlu-new-task`. Read-only — never modifies any file.

---

You are the orchestrator for the `/jlu-list-tasks` command. Your job is to print a
table of the local tasks in the active workspace so the user can see what exists at a
glance. This is the multi-task counterpart to `/jlu-report-task` (which drills into one
task) and `/jlu-load-context` (which reloads one task into a session).

## Step 1 — Resolve the scanner

The deterministic scan + parse lives in `bin/list-tasks.mjs`. It resolves the workspace
itself (from `.spec-workspace.json` or a parent `.spec-workspace/specs/`), scans
`specs/<date>/<slug>/`, and reads each task's `TASKS.md` (lifecycle state, sprint,
affected services) and `SPEC.md` (title).

Resolve it **relative to this workflow file**, not from a variable. This file lives at
`<root>/jelou/workflows/list-tasks.md` and the scanner at `<root>/bin/list-tasks.mjs`, so
`<root>` is the directory two levels above this file. That relationship holds on every
install path — Claude Code marketplace, `bin/install-codex.sh` global and project-local,
`bin/install-opencode.sh` global and project-local, and `codex plugin add`.

Do NOT invoke it through `${PLUGIN_ROOT:-.}`: no runtime exports `PLUGIN_ROOT`, so on
Codex and OpenCode it collapses to `.` and the scanner is looked up inside the user's
service repo, where it does not exist.

## Step 2 — Run the scanner

Substitute the `<root>` you just resolved and run, from the current working directory:

```bash
node "<root>/bin/list-tasks.mjs" --cwd "$PWD"
```

If that path does not exist, stop and report it as an install problem rather than
retrying elsewhere:

```
Scanner not found at `<root>/bin/list-tasks.mjs`. The plugin install is incomplete — reinstall with `/jlu-update`.
```

Pass through any filters the user supplied as the command argument:
- A `--status <state>` argument → append `--status <state>` (e.g. `implementing`, `planned`, `done`).
- A bare lifecycle-state word (e.g. the user typed `/jlu-list-tasks done`) → treat it as `--status done`.

If the command exits non-zero with a "no workspace found" error, print and stop:

```
No JLU workspace found from cwd `<cwd>`: the scanner found neither `.spec-workspace.json` nor a parent `.spec-workspace/specs/` directory.
Run `/jlu-list-tasks` from a registered service repository, or run `/jlu-new-task <description>` from `<cwd>` to create a workspace and task.
```

Do not fabricate a task list.

## Step 3 — Present the table

Print the scanner's table output directly (it is already a formatted, aligned table). Then
add a one-line footer:

```
<N> task(s). Use /jlu-report-task <slug> for detail, or /jlu-load-context <slug> to resume one.
```

If a `--sprint <n>` filter was requested, the scanner does not filter by sprint itself —
drop rows whose `Sprint` column does not match `<n>` before printing, and note the active
filter in the footer.

If the scan returns zero tasks, print the scanner's "No tasks found" line as-is and stop —
do not invent placeholder rows.

> **Read-only guarantee**: this workflow only reads files and runs the scanner. It never
> writes, edits, or deletes anything in the workspace or service repos.
