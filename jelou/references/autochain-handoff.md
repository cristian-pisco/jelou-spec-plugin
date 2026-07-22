# Autochain Handoff — shared recipe

> Single source of truth for the interview→implementation→green chain glue.
> Consumed by `new-task.md`, `refine-task.md`, and `execute-task.md` (Step 9.5).
> Each workflow keeps only its trigger condition inline and follows this recipe
> for the mechanics. Editing flag precedence, the handoff mechanism, or the
> ClickUp reference format happens HERE, once.

## 1. Inline ClickUp reference

The invocation argument may carry a ClickUp task reference: a full URL
(`https://app.clickup.com/t/<id>`) or a bare task id. The reference and the
`--no-autochain` flag are **chain tokens, not content** — strip both from the
argument BEFORE the workflow consumes the remainder (as task description,
change request, or task-slug). When present and
`<TASK_DIR>/CLICKUP_TASK.json` does not exist, seed it with
`{ "task_id": "<id>" }` — the reference BINDS an existing ClickUp task instead
of creating one. All ClickUp work in the chain is **non-blocking**: any
failure is a WARN in the report, never a stop. Interview sessions
(new-task/refine-task) are interactive, so task-clickup's first-run questions
(Equipo/Solicitante, Cliente) may ask normally — their answers persist in
`CLICKUP_TASK.json` and make future unattended runs promptless.

**Hard-stop demotion:** task-clickup.md's Step-0 rule ("stop immediately …
do not proceed") applies to standalone `/jlu-task-clickup` runs. When
task-clickup executes as part of the autochain, that hard-stop is DEMOTED to
WARN-and-skip: report the MCP failure, skip the ClickUp step, continue the
chain. The chain's outcome never depends on ClickUp.

## 2. Flag resolution

Precedence, highest first:

1. A per-invocation `--no-autochain` argument always wins.
2. `JLU_AUTOCHAIN=true|false` environment override.
3. Plugin-global `~/.jlu/settings.json`:
   `node {plugin-root}/bin/jlu-settings.mjs get autochain`
   (the helper seeds the file from `jelou/config/settings.json` on first
   read and never clobbers an existing one; default `true` — the chain is ON
   out of the box, no configuration required).

The chain engages only when the resolved value is `true`. Opting out is the
configured act, not opting in: `--no-autochain` for one invocation,
`JLU_AUTOCHAIN=false` for a session, or `{"autochain": false}` in
`~/.jlu/settings.json` as the standing kill-switch.

## 3. Handoff mechanism

Before handing off, **close the caller's own workflow span**
(`trace-end-span --span "$WORKFLOW_SPAN_ID" --status ok`) — the inlined
execute-task opens its span into the same `WORKFLOW_SPAN_ID` variable; an
unclosed caller span would be orphaned and the caller's later span-close
would double-close execute-task's. The caller's Step N span-close is then
skipped (already done here).

Read `{plugin-root}/jelou/workflows/execute-task.md` and follow it inline in
the SAME session with `<TASK_SLUG>` as argument — the read-and-follow
mechanism every orchestrator already uses. **NEVER a subagent dispatch**:
execute-task's phase confirmations and proposal approvals need `question`
(AskUserQuestion), which only works at L2; dispatching it as a subagent
pushes it to L3 and silently breaks every interactive gate. execute-task's
own Step 9.5 then carries the chain through ship and the PR-green loop.

## 4. Resume after a dead session

The chain's post-ship progress persists in `<TASK_DIR>/AUTOCHAIN.json` (PR
set + per-PR verdicts, written by execute-task Step 9.5b/9.5c). If the
session dies mid-chain (context exhaustion, abort), re-invoking
`/jlu-execute-task <task-slug>` with autochain on re-enters Step 9.5c from
that artifact — already-GREEN PRs are skipped, pending ones get their
runner. Phases are not re-run: execute-task's session recovery already
resumes from the first incomplete phase, and a `ready_to_publish` task has
none.
