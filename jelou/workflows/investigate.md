# Workflow: investigate

Stateful research. One engine per invocation. Persist every round; never invent a fact.

## Inputs
- `topic` — the research question (positional).
- `--engine perplexity|fusion` — default `perplexity`.

## Steps

1. **Locate.** Run `<plugin-root>/bin/investigate.mjs locate --topic "<topic>"`.
   Parse `{ slug, notePath, exists, storage }`.
2. **Load prior context.** If `exists`, read the note (obs: `obs read file="<slug>"`;
   local: read `notePath`) and treat prior rounds as established ground for this round.
3. **Run the engine (exactly one):**
   - `perplexity`: call the runtime's research tool (see runtime contract). Collect
     `{ answer, sources[] }`. Every claim must carry a source.
   - `fusion`: run `<plugin-root>/bin/investigate.mjs fusion --topic "<topic>"`. Parse
     `{ ok, answer, sources, status }`. On `ok:false`, report `status` and persist the
     round as failed/unresolved — never fabricate an answer.
4. **Persist the round.**
   - local storage: write a temp JSON payload (`storage, notePath, exists, slug, title,
     engine, today, question, answer, sources`) and run
     `bin/investigate.mjs persist --payload <tmp.json>`.
   - obs storage: build the same round markdown; `obs create` the note if `!exists`
     (frontmatter + Round 1), else `obs append file="<slug>" content="<round>"` and update
     `updated`/`engines` frontmatter via `obs property:set`.
5. **Report.** Show the answer, the sources (or `sin fuentes — no verificado`), and the
   note path. If no research tool was available at all, say so and persist
   `sin resolver — sin herramienta`. Never assume.

## Hard rules
- One engine per round. No silent failures: a failed engine call is reported and persisted.
- An answer with zero sources is flagged unverified, never presented as fact.
- This is research/decision investigation, NOT debugging. Route failures to /jlu-diagnose.
