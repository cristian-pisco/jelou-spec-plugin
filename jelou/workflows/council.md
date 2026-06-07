# Workflow: council

Multi-model jury for software architecture ideas. Heterogeneous judges (4 OpenRouter
models + optional agentic CLI extras) read a curated case file, try to refute the idea,
and the orchestrating session — acting as arbiter — synthesizes a categorical verdict:
`GO | GO_WITH_CONDITIONS | NO_GO`.

Design source of truth: design doc Revisión 5 (cristianp-main-design-20260606-172535.md).

```
workflow /jlu:council (this session) = ORCHESTRATOR + ARBITER
  │
  ├─ [service resolution 0 or N → ask once]
  │
  ├─ Bash: bin/council.mjs  ──► full fan-out, blind round (Promise.allSettled):
  │        (secrets stay here)   ├── 4 OpenRouter judges, single-shot, expediente-only
  │        prints JSON to stdout └── optional extras: codex exec / gemini -p (agéntico)
  │
  └─ [after] arbiter = this session:
       read envelopes → synthesize → write COUNCIL_REPORT.md into the run dir
```

## Step 1 — Resolve inputs

The argument is the idea: free text, or a path to a file containing the idea.
Optional flags the user may include: `--context <path>` (repeatable; e.g. a SPEC.md).

If the idea is empty or a given path does not exist, stop with a clear error. Do not
launch any judges.

## Step 2 — Resolve workspace and services (case-file scoping)

1. Locate `.spec-workspace.json` from the current directory or up to 5 parent
   directories (same convention as load-context). No workspace → skip to Step 3
   with no `--services` (the report will carry the empty-expediente banner).
2. Read `<WORKSPACE_PATH>/registry/services.yaml`.
3. If the cwd resolves to exactly ONE mapped service, use it directly.
4. If resolution yields zero or multiple services (the common case for cross-service
   ideas run from the workspace root), ask ONCE via `question` (multiSelect) listing
   the registry services: "¿Qué servicio(s) son relevantes para esta idea?" — build
   `--services id1,id2` from the answer. The user may select none; proceed without
   artifacts and let the banner speak.

## Step 3 — Run the fan-out script

```bash
node <plugin-root>/bin/council.mjs "<idea-or-path>" [--context <path> ...] [--services a,b]
```

- Secrets: the script reads `OPENROUTER_API_KEY` from the environment. Never pass it
  as an argument and never echo it.
- The script prints a single JSON document to stdout:
  `{ run_dir, inventory, envelopes: [...] }` — judge raw outputs live as files inside
  `run_dir` (`{judge}.md`, `{judge}.stderr`, `manifest.json`, `prompt.md`).
- Exit ≠ 0 means no usable jury (no key and no CLIs, empty idea, oversized case file,
  or zero judges returned ok). Surface the script's stderr message to the user and stop
  — there is nothing to arbitrate.
- While CLI extras run, the script emits a 30s heartbeat to stderr; relay nothing —
  the user already sees it.

## Step 4 — Arbiter synthesis (this session, never a separate process)

Read `manifest.json` and each judge's raw output from `run_dir` as needed. Then write
`COUNCIL_REPORT.md` INSIDE `run_dir`, in Spanish, with this structure:

1. **Veredicto** — aggregate `GO | GO_WITH_CONDITIONS | NO_GO` + conditions. Derive it
   from the judges' verdicts and the strength of surviving refutations; never average
   numerically.
2. **Banners (when they apply, at the very top):**
   - Exactly one judge ok →
     `SIN SEÑAL CROSS-MODEL — veredicto de un solo modelo: tratar como opinión, no como jurado`
   - Inventory shows 0 artifacts included →
     `EXPEDIENTE VACÍO — los jueces opinaron sin contexto del repo; corre /jlu:map-codebase para enriquecer el expediente`
3. **Expediente** — fixed inventory block: artifacts included (with bytes), absent
   (with reason), straight from the script's `inventory`.
4. **Disenso** — when judges contradict each other, the dissent is the headline of the
   report: present each side's reasoning fairly, with evidence. Never resolve the
   dissent for the user and never average it away — the contradiction IS the signal.
5. **Unique Insights** — ideas raised by only ONE judge that deserve attention, with
   credit. A single judge spotting a fatal flaw is the highest-value signal; never let
   consensus framing bury it.
6. **Attribution** — for each key point in the verdict, name the judge(s) that
   contributed it.
7. **Jueces** — one row per envelope: judge, transport, label `agéntico` (CLI extras)
   or `expediente-only` (API judges), status, elapsed, word_count. Absent/failed
   judges are declared, never hidden.
8. **Discount rules** — agreement between judges of the same provider/family counts as
   weak signal; say so explicitly when it happens. The judge envelope flag
   `same_family_as_arbiter` (the Claude API judge — same family as this arbiter) gets
   an explicit discount in the synthesis: you must distrust your own family's
   agreement with your inclination (self-preference bias).

## Step 5 — Present the report

Print the report location as an absolute path on its own line (clickable in the
terminal):

> Reporte del council: /abs/path/to/run_dir/COUNCIL_REPORT.md

Never print the COUNCIL_REPORT.md content in the terminal. A 3-line summary (verdict +
one-line dissent note + judges alive) is allowed; the document itself is read in the
editor.

## Step 6 — Visual phase for stakeholders (optional, gated)

1. Detect the visual-explainer plugin (e.g. its skills are installed under the Claude
   plugin cache). If absent: print one line —
   `Fase visual omitida: instala con /plugin marketplace add nicobailon/visual-explainer`
   — and finish.
2. If present, ask via `question`: generate the stakeholder one-pager/slides from
   COUNCIL_REPORT.md? Content is verdict-level only (idea, veredicto, top trade-offs,
   disenso, condiciones) — never code excerpts from the repo.
3. If generated, ask via `question` whether to publish (here.now / share-page).
   **NEVER publish without explicit per-run confirmation.** Declining leaves the local
   HTML only. There is no flag, config or default that skips this question.

## Failure handling

- Per-judge failures (timeout, http_error, malformed, empty) never abort the run —
  they arrive as envelopes and are declared in the report (Promise.allSettled fan-out).
- Script exit ≠ 0 → report nothing; show the error and the remediation it suggests
  (export OPENROUTER_API_KEY, trim --services selection, install a CLI, etc.).
