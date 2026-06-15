# Workflow: investigate

Stateful research. One engine per invocation. Persist every round; never invent a fact.

## Inputs
- `topic` — the research question (positional).
- `--engine perplexity|fusion` — default `perplexity`.

## Steps

1. **Locate.** Run `<plugin-root>/bin/investigate.mjs locate "<topic>"`.
   Parse `{ slug, notePath, exists, storage }`.
2. **Load prior context.** If `exists`, read the note (obs: `obs read file="<slug>"`;
   local: read `notePath`) and treat prior rounds as established ground for this round.
3. **Run the engine (exactly one):**
   - `perplexity`: call the runtime's research tool (see runtime contract). Collect
     `{ answer, sources[] }`. Every claim must carry a source.
   - `fusion`: run `<plugin-root>/bin/investigate.mjs fusion "<topic>"`. Parse
     `{ ok, answer, sources, status }`. On `ok:false`, report `status` and persist the
     round as failed/unresolved — never fabricate an answer.
4. **Persist the round.** Build the payload object with: `today` = the current date as
   `YYYY-MM-DD` (run `date +%F`); `title` = the original topic text; `engine`; `question`
   = the topic/sub-question; `answer` and `sources` from Step 3; plus `slug`, `notePath`,
   `exists`, `storage` from Step 1.
   - **local storage**: write the payload to a temp JSON file and run
     `<plugin-root>/bin/investigate.mjs persist --payload <tmp.json>`.
   - **obs storage**: read the existing note when `exists` (`obs read file="<slug>"`) and put
     its full text in the payload as `existingContent` (empty string when new). Run
     `<plugin-root>/bin/investigate.mjs render --payload <tmp.json>` → it returns JSON
     `{ fullNote, roundBlock, engines, updated }`.
     - New note (`!exists`): `obs create path="Resources/Investigations/<slug>.md" content="<fullNote>"`.
     - Resume (`exists`): `obs append file="<slug>" content="<roundBlock>"`, then
       `obs property:set file="<slug>" key=updated value="<updated>"` and
       `obs property:set file="<slug>" key=engines value="[<engines joined by ', '>]"`.
     Use the markdown verbatim so obs notes match local notes.
5. **Report.** Show the answer, the sources (or `sin fuentes — no verificado`), and the
   note path. If no research tool was available at all, say so and persist
   `sin resolver — sin herramienta`. Never assume.

## Hard rules
- One engine per round. No silent failures: a failed engine call is reported and persisted.
- An answer with zero sources is flagged unverified, never presented as fact.
- This is research/decision investigation, NOT debugging. Route failures to /jlu-diagnose.
