# Workflow: council

Multi-model jury for software architecture ideas, run as a **deliberation session
that continues until the user and the jury reach consensus**. Heterogeneous judges
(4 OpenRouter models + optional agentic CLI extras) read a curated case file and try
to refute the idea; the orchestrating session — acting as arbiter — synthesizes each
round, researches whatever the judges flag as uncertain (judges have no live web
access; the arbiter does), and puts the surviving refutations back to the user. The
loop ends when the live refutations are resolved (the jury trends
`GO | GO_WITH_CONDITIONS` and the user accepts the conditions) or the user accepts a
`NO_GO`. On a consensus that clears the idea, the **only** onward step the council
offers is `/jlu-new-task` — never another plugin's planning or spec workflow.

Design source of truth: design doc Revision 5 (cristianp-main-design-20260606-172535.md),
extended with the consensus-session model.

```
workflow /jlu:council (this session) = ORCHESTRATOR + ARBITER + RESEARCHER
  │
  ├─ [service resolution 0 or N → ask once]
  ├─ open session dir  (.spec-workspace/council/<slug>/  or  council-runs/<slug>/)
  │
  ├─ ROUND LOOP (repeat until consensus, hard cap on rounds):
  │     ├─ Bash: bin/council.mjs --session-dir <dir> --round <n> --context <transcript>
  │     │        (secrets stay here)  ├── 4 OpenRouter judges, single-shot, blind
  │     │        prints JSON to stdout └── optional extras: codex/gemini (agentic)
  │     ├─ arbiter synthesizes THIS round (verdict tendency, surviving refutations, dissent)
  │     ├─ arbiter RESEARCHES every judge `uncertainties[]` (Perplexity/web) — never assume
  │     ├─ question: present surviving refutations + researched facts → user rebuts / refines / concedes
  │     └─ consensus? → exit loop.   else → append to transcript, n++ , loop
  │
  ├─ write COUNCIL_REPORT.md (final consensus state + Deliberation) into the session dir
  ├─ [consensus cleared the idea] → EXCLUSIVE handoff: offer /jlu-new-task seeded from the consensus
  └─ [optional] visual phase for stakeholders
```

## Step 1 — Resolve inputs

The argument is the idea: free text, or a path to a file containing the idea.
Optional flags the user may include: `--context <path>` (repeatable; e.g. a SPEC.md).

If the idea is empty or a given path does not exist, stop with a clear error. Do not
launch any judges.

## Step 2 — Resolve workspace and services (case-file scoping)

1. Locate `.spec-workspace.json` from the current directory or up to 5 parent
   directories (same convention as load-context and new-task). Read it and resolve its
   `workspace` field relative to the file's directory — that resolved path is
   `<WORKSPACE_PATH>`, and the workspace data lives at `<WORKSPACE_PATH>/.spec-workspace/`
   (call it `<SPEC_WS_DIR>`). Resolving `<WORKSPACE_PATH>` exactly as new-task does is
   load-bearing: the seed this council writes in Step 6 must land where new-task later globs
   for it, even when the `workspace` field points at a parent directory. No workspace → skip
   to Step 3 with no `--services` (the report will carry the empty-case-file banner).
2. Read the service registry at `<SPEC_WS_DIR>/registry/services.yaml`.
3. If the cwd resolves to exactly ONE mapped service, use it directly.
4. If resolution yields zero or multiple services (the common case for cross-service
   ideas run from the workspace root), ask ONCE via `question` (multiSelect) listing
   the registry services: "Which service(s) are relevant to this idea?" — build
   `--services id1,id2` from the answer. The user may select none; proceed without
   artifacts and let the banner speak.

## Step 3 — Open the deliberation session

1. Choose a stable session directory (so every round groups under one folder and the
   transcript reads in order):
   - workspace present → `<SPEC_WS_DIR>/council/<slug>/` (i.e. `<WORKSPACE_PATH>/.spec-workspace/council/<slug>/`)
   - no workspace → `<cwd>/council-runs/<slug>/`

   This is the SAME `<SPEC_WS_DIR>/council/` (or `<cwd>/council-runs/`) location new-task globs
   for the seed in Step 6 — keep the two in lockstep. `<slug>` is the script's slug of the idea.
   If that directory already exists, append `-<short-timestamp>` so a new session never clobbers
   an old one. This is the `--session-dir` you pass to the script; each round writes into
   `round-<n>/` inside it.
2. Initialize the running **deliberation transcript** at `<session-dir>/deliberation.md`.
   Round 1 starts empty. From round 2 on it holds, under a `## Deliberation so far`
   heading: each prior round's surviving refutations, the user's rebuttals (verbatim
   intent), and the facts the arbiter researched (with their source). The judges read
   this as established ground.
3. Set `ROUND = 1`. The session has a **hard cap of 6 rounds** to guarantee
   termination; reaching the cap is not a silent stop — see Step 4.5.

## Step 4 — Deliberation round (repeat to consensus)

### 4.1 — Run the fan-out for this round

```bash
node <plugin-root>/bin/council.mjs "<idea-or-path>" \
  --session-dir <session-dir> --round <ROUND> \
  [--services a,b] [--context <path> ...] [--context <session-dir>/deliberation.md]
```

- Pass `--context <session-dir>/deliberation.md` on every round after the first, so the
  blind judges see the deliberation so far.
- Secrets: the script reads `OPENROUTER_API_KEY` from the environment. Never pass it
  as an argument and never echo it.
- The script prints a single JSON document to stdout:
  `{ run_dir, round, inventory, envelopes: [...] }` — judge raw outputs live as files
  inside `run_dir` (`{judge}.md`, `{judge}.stderr`, `manifest.json`, `prompt.md`).
- Exit ≠ 0 means no usable jury (no key and no CLIs, empty idea, oversized case file,
  or zero judges returned ok). Surface the script's stderr message to the user and stop
  — there is nothing to arbitrate.
- While CLI extras run, the script emits a 30s heartbeat to stderr; relay nothing —
  the user already sees it.

### 4.2 — Arbiter synthesis of this round (this session, never a separate process)

Read `manifest.json` and each judge's raw output from this round's `run_dir`. Produce,
for this round, the same rigor the final report demands (kept lighter per round):

- **Verdict tendency** — aggregate `GO | GO_WITH_CONDITIONS | NO_GO`. Derive it from the
  judges' verdicts and the strength of surviving refutations; never average numerically.
- **Surviving refutations** — refutations that still stand after this round, each with its
  concrete evidence. Drop any the user has already answered with evidence in a prior round.
- **Dissent** — when judges contradict each other, the dissent is the headline:
  present each side's reasoning fairly, with evidence. Never resolve the dissent for the
  user and never average it away — the contradiction IS the signal.
- **Unique Insights** — points raised by only ONE judge that deserve attention, with credit.
  A single judge spotting a fatal flaw is the highest-value signal; never let consensus
  framing bury it.
- **Discount rules** — agreement between judges of the same provider/family counts as weak
  signal; say so. The envelope flag `same_family_as_arbiter` (the Claude API judge — same
  family as this arbiter) gets an explicit discount: distrust your own family's agreement
  with your inclination (self-preference bias).
- **Banners (when they apply):**
  - Exactly one judge ok this round →
    `NO CROSS-MODEL SIGNAL — single-model verdict: treat as an opinion, not a jury`
  - Inventory shows 0 artifacts included →
    `EMPTY CASE FILE — the judges opined without repo context; run /jlu:map-codebase to enrich the case file`
- Per-round judge labelling stays: API judges are `case-file-only`; CLI extras are `agentic`.

### 4.3 — Resolve the judges' uncertainties (arbiter researches; never assume)

Collect every `uncertainties[]` entry across this round's envelopes. For each one, the
arbiter — not the judges — establishes the fact. **No LLM in this council assumes; if a
fact is not known, it is researched, not invented.**

1. Research each uncertainty with your runtime's web research tool — Perplexity if your
   runtime has it, otherwise the native web search. (Each runtime maps "research" to its own
   tool in its runtime contract; this workflow stays tool-agnostic.)
2. If your runtime has no web tool at all, say so explicitly to the user and treat the
   uncertainty as unresolved — never paper over it with an assumption.
3. **Write each finding to `<session-dir>/deliberation.md`** under a `## Researched facts`
   heading for this round — as `uncertainty → fact — source (url/citation)` — BEFORE you put
   the round to the user (§4.4). This is exactly what the next round's blind judges read as
   established ground, so persisting it now (not just narrating it in the question) is what
   closes the loop. A finding that contradicts a judge's refutation neutralizes it; a finding
   that confirms one strengthens it. Attribute facts to their source, not to a judge's guess.

### 4.4 — Put the round to the user

Via `question`, present a compact picture of this round (never dump a file): the verdict
tendency, the surviving refutations each paired with the fact the arbiter researched (or
"unresolved" when no web tool was available), and the dissent if any. Then let the user
drive — the options depend on the verdict tendency:
- **Accept the verdict** — offered whenever the jury trends `GO` (a clean `GO` with no live
  refutations) or `GO_WITH_CONDITIONS`; for `GO_WITH_CONDITIONS` this means accepting the
  conditions as they stand. Choosing it reaches consensus (§4.5). A clean `GO` is never auto-
  exited — the user still gets this explicit accept so consensus is genuinely user+jury.
- **Rebut with evidence** — the user answers a specific refutation (capture their point).
- **Refine the idea** — the user narrows scope or changes the mechanism. Record it in
  `deliberation.md` ("**Refined idea (round N):** <before> → <after>") and use the refined
  wording as the idea argument for the next round's fan-out (§4.1).
- **Concede** — the user accepts a `NO_GO` (or decides to abandon/pivot).

Append the user's response to `deliberation.md` under `## Deliberation so far` (after the
`## Researched facts` you wrote in §4.3) so the next round's judges and the final report
both see it.

### 4.5 — Consensus check and loop control

Consensus is reached — **end the loop** — when either holds:
- the user chose **Accept the verdict** while the jury trends `GO` or `GO_WITH_CONDITIONS`
  (live refutations resolved and any conditions accepted), or
- the user concedes a `NO_GO`.

Otherwise, increment `ROUND` and run another round (Step 4.1) with the (possibly refined)
idea + transcript. **Round cap (absolute):** the session runs at most 6 rounds. Warn the user
on the penultimate round that the next one is the last. When `ROUND` reaches 6, do not loop
silently and do not offer "one more round" again — present the still-live refutations and ask
via `question` for a terminal choice only: accept the verdict, concede, or stop and record the
current (non-consensus) state as the verdict. The loop never exceeds 6 rounds.

## Step 5 — Write the final consensus report

Write `COUNCIL_REPORT.md` INSIDE the session dir, in English, reflecting the FINAL state of
the deliberation (not just the last round). Structure:

1. **Verdict** — the consensus `GO | GO_WITH_CONDITIONS | NO_GO` + conditions, and one line
   on how the deliberation got there.
2. **Banners** (at the very top, when they apply): the `NO CROSS-MODEL SIGNAL` and
   `EMPTY CASE FILE` banners from §4.2, judged on the final round.
3. **Deliberation** — the round-by-round arc: how many rounds, which refutations were
   resolved (and by which researched fact + source), which the user answered, and what
   the user refined. This is what distinguishes a session from a one-shot verdict.
4. **Case file** — fixed inventory block: artifacts included (with bytes), absent (with
   reason), straight from the script's `inventory`.
5. **Dissent** — any dissent that survived to the end, presented fairly per side, never
   resolved for the user and never averaged away — the contradiction IS the signal.
6. **Unique Insights** — points raised by only ONE judge that deserve attention, with credit.
7. **Attribution** — for each key point in the verdict, name the judge(s) that contributed it,
   and for each resolved uncertainty, name the source the arbiter researched.
8. **Judges** — one row per envelope (final round, with prior rounds noted): judge, transport,
   label `agentic` (CLI extras) or `case-file-only` (API judges), status, elapsed, word_count.
   Absent/failed judges are declared, never hidden.
9. **Discount rules** — restate the correlated-agreement discount, including the explicit
   `same_family_as_arbiter` discount of the Claude API judge.

### Present the report

Print the report location as an absolute path on its own line (clickable in the terminal):

> Council report: /abs/path/to/session-dir/COUNCIL_REPORT.md

Never print the COUNCIL_REPORT.md content in the terminal. A 3-line summary (verdict +
one-line dissent note + judges alive) is allowed; the document itself is read in the editor.

## Step 6 — Onward routing: EXCLUSIVE handoff to /jlu-new-task

This is why the council exists: to funnel a vetted architecture decision **into the JLU
spec pipeline**, not to hand the user off to a competing workflow.

**Hard rule — onward routing is exclusive to `/jlu-new-task`.** Do NOT suggest, mention,
or invoke any other planning, brainstorming, or spec workflow as the next step — not
superpowers (brainstorming, writing-plans, execute-plan), not GSD, not gstack
(office-hours, ship, plan-*), not any non-JLU "spec" or "plan" tool. If the user explicitly
asks about another tool you may answer factually, but the recommended and default next step
is always `/jlu-new-task`. Recommending a competing workflow defeats the council's purpose.

### The seed is the context bridge (fresh-window handoff)

A multi-round deliberation can consume a large share of THIS session's context window. So
the handoff is built so `/jlu-new-task` can start in a **fresh window** with the full task
context loaded from disk, never from this conversation's memory:

1. Write a **self-sufficient** `<session-dir>/new-task-seed.md` — complete enough that a
   brand-new `/jlu-new-task` session needs nothing from this chat:
   - the refined one-line idea (the thing to build);
   - the conditions the user accepted to reach consensus (the consensus round's
     `GO_WITH_CONDITIONS` conditions; none for a clean `GO`) as acceptance-criteria bullets;
   - the services in scope (from Step 2);
   - the key surviving trade-offs the team should keep in mind;
   - absolute-path pointers to `COUNCIL_REPORT.md` and `deliberation.md` for the full record.

> `/jlu-new-task` cannot run inside a sub-agent — its spec interview needs `AskUserQuestion`
> at the top level (L2). So a truly fresh context window comes from a **new top-level
> session** (`/clear` or a new terminal in the same repo), not from a delegated agent.

### Drive the handoff (consensus `GO` / `GO_WITH_CONDITIONS`)

Ask via `question`: "The council reached consensus (`<verdict>`). How do we create the task with
`/jlu-new-task`?" with options:

- **"In a fresh session — clean context (recommended)"** — tell the user to open a fresh
  session (`/clear`, or a new terminal in this repo) and run `/jlu-new-task`. It auto-detects
  this council's pending `new-task-seed.md` and offers to load it, so the full task context
  reloads from disk into a ~0% window with nothing to paste. (The explicit form also works:
  `/jlu-new-task <idea>. Context in <abs>/new-task-seed.md and <abs>/COUNCIL_REPORT.md — read them first.`)
  **Recommend this whenever the deliberation ran more than a round or two** — a long session
  leaves little window for `/jlu-new-task`'s own interview.
- **"Now, in this session"** — invoke `/jlu-new-task` inline, seeded with the contents of
  `new-task-seed.md` as its task description. Seamless, but it shares THIS session's context
  window — only sensible when the deliberation was short and the window is still light.
  (Each runtime invokes a sibling command its own way — see its runtime contract; e.g.
  Claude Code invokes the `new-task` skill via the `Skill` tool with the seed text,
  OpenCode/Codex run the `jlu-new-task` command with the seed as the argument.)
- **"Not yet — leave the seed and close"** — print the same fresh-session command for
  later and finish. The seed file already holds the full detail.

### Consensus `NO_GO` (user conceded)

Do NOT route to `/jlu-new-task` and do NOT write a seed. Offer via `question`: re-refine the
idea and run another council session, or close.

## Step 7 — Visual phase for stakeholders (optional, gated)

1. Detect the visual-explainer plugin (e.g. its skills are installed under the Claude
   plugin cache). If absent: print one line —
   `Visual phase skipped: install with /plugin marketplace add nicobailon/visual-explainer`
   — and finish.
2. If present, ask via `question`: generate the stakeholder one-pager/slides from
   COUNCIL_REPORT.md? Content is verdict-level only (idea, verdict, top trade-offs,
   dissent, conditions) — never code excerpts from the repo.
3. If generated, ask via `question` whether to publish (here.now / share-page).
   **NEVER publish without explicit per-run confirmation.** Declining leaves the local
   HTML only. There is no flag, config or default that skips this question.

## Failure handling

- Per-judge failures (timeout, http_error, malformed, empty) never abort a round —
  they arrive as envelopes and are declared in the report (Promise.allSettled fan-out).
- Script exit ≠ 0 in any round → report nothing for that round; show the error and the
  remediation it suggests (export OPENROUTER_API_KEY, trim --services selection, install a
  CLI, etc.). A failed round does not advance the consensus loop.
- No web tool available for §4.3 → declare each uncertainty unresolved; never assume it away.
