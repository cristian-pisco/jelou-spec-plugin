# Autonomous mode — shared contract

Canonical contract for workflows that can run with no human at the keyboard.
`ship.md` owns its own gate table and predates this file; new workflows adopting
autonomous mode point here for the contract and keep their gate table inline.

## The input

`<AUTONOMOUS>` is a caller input, `no` unless the caller says otherwise. Callers
that set it: `/jlu-bench`, the post-interview autochain, and any workflow that
hands it down to a workflow it invokes. A user typing the command interactively
never gets autonomous mode implicitly — it is always an explicit hand-off.

## The rule

**In autonomous mode no gate asks.** Each gate resolves to its documented default,
records one line of disclosure, and continues. The disclosure is what makes this
safe: nothing is waved through silently. A gate with no documented default is a
bug in the workflow, not a licence to improvise a question.

Every workflow that supports autonomous mode MUST publish a **closed gate table**
— `| Gate | Site | Autonomous default |` — covering every site where it would
otherwise ask. Closed means: if a decision is not in the table, autonomous mode
may not invent a confirmation for it, and may not silently pick either branch.

## Where disclosure goes

| Workflow | Channel |
|---|---|
| `ship` | `SHIP_CAVEATS` → rendered in the PR body |
| `new-task` | `## Assumptions` in `SPEC.md` |
| `refine-task` | `## Assumptions` in `SPEC.md` (appended, never rewritten) |
| `map-codebase` | `User interview: deferred (autonomous)` in the concerns doc |

## What autonomous mode may never do

1. **Change the task's own contract.** It resolves gates; it does not edit what
   was agreed (task status, Dual-PR intent already stored, spec requirements the
   user wrote).
2. **Invent scope.** A gap that cannot be resolved from the inputs takes a
   conservative default and is disclosed — it is never filled with a feature
   nobody asked for.
3. **Waive a hard floor.** Case-coverage floors, test-tier bans and the like are
   not gates; autonomous mode has no authority over them.
4. **Proceed without a contract.** See the abort floor below.

## The abort floor

Autonomous mode aborts — cleanly, with a stated reason, creating nothing — when
the inputs do not contain enough to define what is being built. Concretely:

- `new-task`: the description yields no concrete functional requirement. "We need
  reports" names a want, not a contract. Abort; do not create the task.
- `refine-task`: no target task resolves, or the requested change cannot be tied
  to an existing requirement.
- `ship`: task status is `draft` or `refining` (its own table, unchanged).

Aborting is the correct outcome, not a failure of the mode: a caller that meets
the floor gets a task, and one that does not gets a clear reason to escalate to a
human. Inventing the missing contract is the failure.

## Resolution order for open gaps

Fixed gates read their default from the table. An **open gap** — one the workflow
discovered rather than one it always asks — resolves in this order:

1. **From the inputs.** The description, seed, spec, or codebase docs already
   answer it. Use that; no disclosure needed (it was never a gap).
2. **From `<ANSWERS_FILE>`,** when the caller supplied one: a markdown or YAML
   file of pre-recorded answers. A gap matched here is resolved and disclosed as
   `answered from <file>`. This is how a benchmark keeps runs deterministic.
3. **Conservative default + disclosure.** The narrowest defensible reading of the
   requirement, recorded in the disclosure channel with the gap it resolves.

If step 3 would have to decide *what to build* rather than *how to build it*, the
abort floor applies instead.
