# Workflow: architecture-review

> Orchestrator workflow for `/jlu-architecture-review [<service-id>] [--cross-service]`
> Surfaces deepening opportunities and runs a grilling loop on user-selected candidates.

> **Tool requirement**: All prompts and questions to the user are delegated to the grill agent, except the candidate-selection prompt in Step 5 which is handled by the orchestrator via `AskUserQuestion`.

---

**Resolve the plugin root before the first step.** Steps below run a `bin/*.mjs` script. Derive it
per `jelou/references/plugin-root.md`: this file lives at `<root>/jelou/workflows/architecture-review.md`, so the
plugin root is the directory **two levels above it**. Substitute that absolute path wherever this
workflow writes `<plugin-root>` or `{plugin-root}`. Never fall back to `$PLUGIN_ROOT`, which no
runtime exports.

## Step 1 — Resolve Workspace

1. Read `.spec-workspace.json` from the current working directory.
2. If it exists, extract the `workspace` field and resolve it relative to CWD.
3. If `.spec-workspace.json` is missing OR the resolved path does not exist:
   a. Search parent directories (up to 5 levels) for a `.spec-workspace/` directory.
   b. If still not found:
      Stop with: "/jlu-architecture-review requires a `.spec-workspace/`. Run `/jlu-map-codebase` first to set one up."
4. Verify `<WORKSPACE_PATH>/registry/services.yaml` exists.

**Store**: `WORKSPACE_PATH` = absolute path to `.spec-workspace/`.

---

## Step 2 — Resolve Mode and Scope

Argument parsing (the launcher passes raw `{argument}` text):

- `<service-id>` only → `MODE = single`, `SCOPED_SERVICES = [<service-id>]`.
- `--cross-service` only → `MODE = cross`, `SCOPED_SERVICES` = every service in `services.yaml` whose `<WORKSPACE_PATH>/services/<id>/codebase/` exists.
- `--cross-service <service-id>` → `MODE = cross`, `SCOPED_SERVICES` = the named service plus services it integrates with (derived from that service's `INTEGRATIONS.md`).
- No argument → stop with: "Pass `<service-id>` for single-service mode, or `--cross-service` for workspace mode."

For each scoped service, resolve its `source_root` from `services.yaml` and verify `<WORKSPACE_PATH>/services/<id>/codebase/` exists. If any service in scope is unmapped, stop with: "Service `<id>` not yet mapped. Run `/jlu-map-codebase <id>` first."

If `MODE == cross` and `SCOPED_SERVICES.length == 1`, downgrade to `MODE = single` with a one-line warning.

**Store**: `MODE`, `SCOPED_SERVICES` = list of `{id, source_root, codebase_dir}`.

---

## Step 3 — Load Knowledge Files (read-only)

For each service in `SCOPED_SERVICES`:

- Read these five files from `<codebase_dir>`: `ARCHITECTURE.md`, `STRUCTURE.md`, `INTEGRATIONS.md`, `CONVENTIONS.md`, `CONCERNS.md`. Skip `STACK.md`.

Workspace-level:

- Read `<WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.md` if it exists → `DOMAIN_TERMS`. If absent, `DOMAIN_TERMS = ""` and the Step 8 summary suggests running `/jlu-ubiquitous-language`.
- Glob `<WORKSPACE_PATH>/decisions/ADR-*.md`. For each, read the YAML frontmatter (`id`, `slug`, `service`, `title`, `status`) and the `## Load-bearing reason for future explorers` section. Filter:
  - `MODE == single`: keep ADRs whose `service` equals `<scoped-service-id>` OR `workspace`.
  - `MODE == cross`: keep ADRs whose `service` equals `workspace` OR matches any in `SCOPED_SERVICES`.
  Store as `EXISTING_ADRS`.
- Read `<plugin-root>/jelou/references/architecture-language.md` → `ARCH_VOCAB`.

---

## Step 4 — Dispatch Explorer Agent

Pre-create `<WORKSPACE_PATH>/.tmp/architecture/` if missing.

Set `OUTPUT_FRAGMENT`:
- `MODE == single`: `<WORKSPACE_PATH>/.tmp/architecture/<service-id>.candidates.json`
- `MODE == cross`: `<WORKSPACE_PATH>/.tmp/architecture/cross-<YYYYMMDD>.candidates.json`

Dispatch a SINGLE `jlu-architecture-explorer` agent (model: `sonnet`) with this prompt prefix:

```
MODE: <MODE>
SCOPED_SERVICES: <JSON array of {id, source_root, codebase_dir}>
DOMAIN_TERMS: <full content of UBIQUITOUS_LANGUAGE.md, or empty string>
EXISTING_ADRS: <JSON array filtered above>
OUTPUT_FRAGMENT: <absolute path>

Knowledge files (one block per service):

--- service: <id> ---

ARCHITECTURE.md:
<content>

STRUCTURE.md:
<content>

INTEGRATIONS.md:
<content>

CONVENTIONS.md:
<content>

CONCERNS.md:
<content>

--- end service: <id> ---

ARCH_VOCAB:
<full content of architecture-language.md>
```

Followed by the full content of `<plugin-root>/agents/jlu-architecture-explorer.md`.

**Single dispatch — not parallel-per-service.** Cross-service analysis is inherently joined; splitting it would lose the seam-finding payoff.

If the explorer fails, stop and report. No partial state.

---

## Step 5 — Render Report and Prompt for Selection

Determine `REPORT_PATH`:
- `MODE == single`: `<WORKSPACE_PATH>/services/<service-id>/codebase/ARCHITECTURE_REVIEW.md`
- `MODE == cross`: `<WORKSPACE_PATH>/services/<each in-scope service>/codebase/ARCHITECTURE_REVIEW.cross-service.md`

For single-service mode, run the renderer:

```bash
node <plugin-root>/bin/architecture-review-render.mjs \
  --fragment <OUTPUT_FRAGMENT> \
  --report <REPORT_PATH> \
  --service-id <service-id>
```

For cross-service mode, run once per in-scope service (each gets the same content):

```bash
node <plugin-root>/bin/architecture-review-render.mjs \
  --fragment <OUTPUT_FRAGMENT> \
  --report <per-service REPORT_PATH> \
  --mode cross
```

Read the fragment back into memory (you'll need the candidate list for the prompt).

Verify exit 0. Delete `<OUTPUT_FRAGMENT>` only after all renderer invocations succeed.

Display via `AskUserQuestion`:

- Question: `"Architecture review for <scope> — what next?"`
- Options:
  - `"Pick #1: <title>"` — one option per candidate, capped at the explorer's max of 7
  - `"Done"` — exit, report file is saved

Map the user's selection back to the candidate record. If `"Done"`, jump to Step 8.

---

## Step 6 — Dispatch Grill Agent

Pre-allocate the next ADR number:

```bash
node <plugin-root>/bin/architecture-review-allocate-adr.mjs \
  --decisions-dir <WORKSPACE_PATH>/decisions
```

Capture stdout as `NEXT_ADR_NUMBER` (e.g. `0007`). Verify exit 0.

Ensure `<WORKSPACE_PATH>/decisions/` exists (create if missing).

Dispatch a SINGLE `jlu-architecture-grill` agent (model: `opus`) with this prompt prefix:

```
CANDIDATE: <JSON of the selected candidate record>
DOMAIN_TERMS: <full content of UBIQUITOUS_LANGUAGE.md, or empty string>
EXISTING_ADRS: <same JSON as Step 4>
REPORT_PATH: <absolute path>
ADR_DIR: <WORKSPACE_PATH>/decisions/
NEXT_ADR_NUMBER: <padded number>

Knowledge files (one block per scoped service): <same shape as Step 4>

ARCH_VOCAB:
<full content of architecture-language.md>
```

Followed by the full content of `<plugin-root>/agents/jlu-architecture-grill.md`.

Wait for the grill to complete. The grill writes outcomes directly to `REPORT_PATH` and (on rejection-with-reason) to `<ADR_DIR>/ADR-<NEXT_ADR_NUMBER>-<slug>.md`.

If the grill fails:
- Whatever was already written to `REPORT_PATH` survives (atomic appends are the agent's responsibility).
- An ADR file is written via temp-and-rename, so a partial ADR is not possible.
- Report the failure and return to Step 5 (the user can re-pick from the unchanged candidate list).

---

## Step 7 — Loop or Exit

After each grill cycle, return to Step 5's selection prompt. The candidate list is unchanged (the renderer only runs once at the start of the run); the grill's outputs accumulate in the `## Grilled candidates` and `## Rejections` sections.

When the user picks `"Done"`, proceed to Step 8.

---

## Step 8 — Final Summary

Read `REPORT_PATH` to count outcomes. Glob `<ADR_DIR>/ADR-*.md` for ADRs whose mtime is within this run's window.

Print:

```
## Architecture Review Complete
- Mode: <single|cross>
- Scope: <list of service ids>
- Candidates surfaced: N
- Grilled: M (K survived, J rejected, I recorded as ADRs)
- Report: <REPORT_PATH>
- ADRs created: <list>

To turn a survived candidate into a task:
    /jlu-new-task
    [paste candidate brief from <REPORT_PATH>#grilled-candidates as the seed]
```

If `DOMAIN_TERMS` was empty, append:

```
Note: no canonical glossary found. Run /jlu-ubiquitous-language to canonicalize concept names before the next architecture review.
```

If any candidate carried `missing_domain_term`, append:

```
Note: terms surfaced during this run are listed in <REPORT_PATH>#terms-surfaced-during-architecture-review.
```

---

## Workflow Rules

- **Single explorer dispatch** — even in `MODE=cross`. Cross-service analysis is joined.
- **Grill owns user interaction** — the orchestrator only handles the candidate-selection prompt and the final summary.
- **Re-runs are idempotent** — the report is overwritten; ADRs are append-only.
- **ADR numbers are global** to the workspace, not per-service.
- **No auto-hooks** into other workflows — this skill is standalone.
