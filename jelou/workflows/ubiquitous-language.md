# Workflow: ubiquitous-language

> Orchestrator workflow for `/jlu-ubiquitous-language [service-id]`
> Curates the workspace's domain glossary using parallel extraction agents and a single curator agent with a review-then-save loop.

> **Tool requirement**: All prompts, questions, and confirmations to the user in this workflow MUST be delegated to the curator agent. The orchestrator itself never asks the user anything.

---

## Step 1 — Resolve Workspace

1. Read `.spec-workspace.json` from the current working directory.
2. If it exists, extract the `workspace` field and resolve it relative to CWD.
3. If `.spec-workspace.json` is missing OR the resolved path does not exist:
   a. Search parent directories (up to 5 levels) for a `.spec-workspace/` directory.
   b. If still not found:
      Stop with: "/jlu-ubiquitous-language requires a `.spec-workspace/`. Run `/jlu-map-codebase` first to set one up."
4. Verify `<WORKSPACE_PATH>/registry/services.yaml` exists.

**Store**: `WORKSPACE_PATH` = absolute path to `.spec-workspace/`.

---

## Step 2 — Resolve Scope

1. If `service-id` was provided as a command argument, set `SCOPED_SERVICE_IDS = [<service-id>]`.
2. Otherwise, read `<WORKSPACE_PATH>/registry/services.yaml` and extract every service id; set `SCOPED_SERVICE_IDS = [all ids]`.
3. For each id in `SCOPED_SERVICE_IDS`, resolve its source path from `services.yaml` (`path` field, relative to workspace).
   - Verify each path exists. If any does not, drop that service from scope and log a one-line warning.

**Store**: `SCOPED_SERVICES` = list of `{id, source_root}` pairs that exist on disk.

---

## Step 3 — Ensure Glossary Directory

1. Create `<WORKSPACE_PATH>/glossary/` if missing.
2. Read `<WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.md` if it exists → `EXISTING_GLOSSARY_CONTENT`.
3. Read `<WORKSPACE_PATH>/glossary/candidates.json` if it exists → `ACCUMULATED_CANDIDATES`.
4. Read `<WORKSPACE_PATH>/glossary/.last-curation.json` if it exists → `LAST_CURATION` (per-service commit map).

**Store**: paths and contents above.

---

## Step 4 — Determine Re-Extraction Set

For each service `{id, source_root}` in `SCOPED_SERVICES`:

1. If `LAST_CURATION` has no entry for this id → mark `MUST_EXTRACT`.
2. Else, run: `cd <source_root> && git rev-parse HEAD` → `CURRENT_SHA`.
   - If `CURRENT_SHA == LAST_CURATION.service_commits[id]` → mark `SKIP_EXTRACTION`.
   - Else → mark `MUST_EXTRACT`.
3. Record `current_commit: CURRENT_SHA` for each scoped service (used by Step 8).

**Store**:
- `SERVICES_TO_EXTRACT` = subset of `SCOPED_SERVICES` to be extracted.
- Augment each entry in `SCOPED_SERVICES` with `current_commit` (so `SCOPED_SERVICES` now has shape `[{id, source_root, current_commit}, ...]`).

If `SERVICES_TO_EXTRACT` is empty AND `ACCUMULATED_CANDIDATES.candidates` is empty AND no spec/interview artifacts are newer than `LAST_CURATION.curated_at`, log "Nothing to curate. Glossary is up-to-date." and exit cleanly (skip remaining steps).

---

## Step 5 — Dispatch Extractor Agents in Parallel

For each service in `SERVICES_TO_EXTRACT`, dispatch one `jlu-glossary-extractor` agent.

**Mandatory rule**: All extractor Agent tool calls go in a SINGLE response (mirror `map-codebase` Step 5 parallel pattern).

Each agent receives this prompt prefix:

```
service-id: <service-id>
SOURCE_ROOT: <source_root>
OUTPUT_FRAGMENT: <WORKSPACE_PATH>/glossary/.tmp/<service-id>.candidates.json
EXISTING_TERMS: <comma-separated list of canonical term names + accumulated candidate names>
MODE: standalone
```

Followed by the full content of `<plugin-root>/agents/jlu-glossary-extractor.md`.

Model: `sonnet`.

Wait for all extractors to complete. If one fails:
- Continue with the rest.
- Capture which service failed.
- The Step 9 report includes the failure.

---

## Step 6 — Collate Candidates

Run the merge helper:

```bash
node <plugin-root>/bin/glossary-merge.mjs --glossary-dir <WORKSPACE_PATH>/glossary
```

This:
- Reads every `*.candidates.json` fragment under `.tmp/`.
- Merges into `<WORKSPACE_PATH>/glossary/candidates.json` (creating it if missing).
- Drops candidates whose names are in `dropped[]` or `promoted[]`.
- Deletes fragment files after a successful merge.

Verify the merger exited 0. If it exited non-zero, stop and report the error.

---

## Step 7 — Read Spec/Conversation Artifacts

Glob:
- `<WORKSPACE_PATH>/specs/**/SPEC.md` → `SPEC_FILES`
- `<WORKSPACE_PATH>/specs/**/INTERVIEW.md` → `INTERVIEW_FILES` (may be empty — current workflows don't write a separate interview transcript; the section appended by Hook B in the SPEC.md is what the curator reads)

Pass file paths only — the curator reads each file as needed.

---

## Step 8 — Dispatch Curator Agent (single, sequential)

Spawn ONE `jlu-glossary-curator` agent. Model: `sonnet`. Prompt prefix:

```
WORKSPACE_PATH: <WORKSPACE_PATH>
EXISTING_GLOSSARY_PATH: <WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.md
CANDIDATES_PATH: <WORKSPACE_PATH>/glossary/candidates.json
DRAFT_PATH: <WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.draft.md
MARKER_PATH: <WORKSPACE_PATH>/glossary/.last-curation.json
SPEC_FILES: <comma-separated paths>
INTERVIEW_FILES: <comma-separated paths>
SCOPED_SERVICES: <JSON array of {id, current_commit} from Step 4>
```

Followed by the full content of `<plugin-root>/agents/jlu-glossary-curator.md`.

Wait for the curator to return. The curator owns the entire interactive review loop; the orchestrator just collects its final summary.

---

## Step 9 — Report Summary

Print to the user:

```
## Ubiquitous Language Curation Complete

- Terms added: <N>
- Terms updated: <M>
- Terms removed: <K>
- Ambiguities resolved: <count>
- Services re-scanned: <comma-separated list>
- Services skipped (unchanged): <comma-separated list>
- Failed extractions: <list, if any>
- Glossary: <WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.md
```

If the curator reported cancellation, print: `Cancelled. No changes written.` and exit 0.

---

## Error Handling

| Error | Action |
|-------|--------|
| `.spec-workspace/` not found anywhere | Stop with the message in Step 1 |
| `services.yaml` missing | Stop with: "Workspace registry missing — run /jlu-map-codebase first." |
| All scoped services' source paths missing on disk | Stop with: "No scoped services exist on disk." |
| `bin/glossary-merge.mjs` not found | Stop with: "Plugin install incomplete — bin/glossary-merge.mjs missing." |
| Single extractor agent failure | Continue; report in Step 9; user can re-run scoped to that service |
| Curator agent failure mid-draft | No canonical/candidates/marker mutation. Draft sidecar may remain — manual cleanup is `rm <WORKSPACE_PATH>/glossary/UBIQUITOUS_LANGUAGE.draft.md` |
| User cancels review | Draft deleted by curator; canonical untouched; clean exit |

---

## Artifact Paths

| Artifact | Path |
|----------|------|
| Canonical glossary | `.spec-workspace/glossary/UBIQUITOUS_LANGUAGE.md` |
| Draft (transient) | `.spec-workspace/glossary/UBIQUITOUS_LANGUAGE.draft.md` |
| Candidates sidecar | `.spec-workspace/glossary/candidates.json` |
| Curation marker | `.spec-workspace/glossary/.last-curation.json` |
| Per-run fragments (transient) | `.spec-workspace/glossary/.tmp/<service-id>.candidates.json` |
