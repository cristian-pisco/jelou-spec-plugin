# Closure Comment Template

Template for the comment posted on the ClickUp macro task when
`/jlu-close-task` runs.

The closure comment must read like a short note a teammate would write to
explain what shipped — not like a deploy log. ClickUp already shows author,
timestamp, and status change automatically; do not duplicate that metadata in
the comment body.

## Language and tone

- **Language: English.** Always. Never Spanish, regardless of where the
  rest of the artifacts are written.
- **Tone: natural language.** Write the way you would summarize the work in
  a stand-up. Avoid jargon, command names, internal slugs, file paths,
  status enums, test counts, or ISO timestamps.
- **Audience: a stakeholder skimming the task page.** They care about what
  changed for the user and what's next, not how it was implemented.

## Structure

The comment has up to two paragraphs, in this order:

1. **Summary** (required) — 2 to 5 sentences describing what was delivered
   in plain English. Lead with the user-visible outcome; mention the
   technical change only if it explains the outcome.
2. **Future improvements** (optional) — 1 to 2 sentences pointing at a
   natural follow-up. **Only include this paragraph when there is concrete
   evidence** of a follow-up: a `TODO` left in the code, a deferred phase
   in `TASKS.md`, an item the user explicitly punted, or a known
   limitation called out in `SPEC.md`. **Never invent follow-ups** to
   pad the comment.

Separate the two paragraphs with a blank line. No headers, no bullet
lists, no horizontal rules. Plain prose only.

## Hard prohibitions

The closure comment MUST NOT contain any of the following:

- **PR URLs or PR numbers.** `/jlu-task-clickup` already attaches a
  separate "Pull Requests" comment. Repeating PRs here is noise.
- **Signature line** like `Task closed by /jlu:close-task at <timestamp>`.
  ClickUp's own activity log shows author and time.
- **Test counts** (`697 tests passing`, `18/18`, etc.).
- **Phase counts** (`All 3 phases done`).
- **Internal slugs, IDs, or branch names** (`<task-slug>`,
  `production/<...>`, `86e148mfg`).
- **File paths or symbol names** (`libs/.../modal.tsx`,
  `useLayoutEffect`).
- **Service IDs in code form** (`orchestrator-service`,
  `workflow-engine-service`). If a service must be referenced, use its
  human-readable name (e.g., "the workflow engine", "the chatbot
  server").
- **ISO-8601 timestamps** anywhere in the body.
- **Markdown formatting tokens** beyond paragraph breaks: no `**bold**`,
  no `# headers`, no fenced code, no bullet lists.

## Examples

### Good — feature with a clear follow-up

```
The "Test Configuration" modal in the AI Router skill now matches the rest of
the workspace by using the canonical Modal component, so the look and feel is
consistent across the app. We also tightened the form so the phone field only
appears when the active filters actually need it, and validation errors only
show up after the user has interacted with the field — no more red asterisks
on first open.

A natural follow-up is to migrate the remaining workflow nodes that still
rely on the legacy modal primitive, which is tracked separately.
```

### Good — bug fix without a follow-up

```
The marketplace search now returns results again. The page was failing with
a server error whenever a user searched for an app, caused by a regression
in the query layer that was introduced during the last refactor. The fix
restores the previous behavior and adds a regression test so it does not
slip through again.
```

### Good — small improvement

```
The configuration of the start node is now visible in the run logs whenever
the AI Router is enabled, which makes debugging "why did the bot pick this
branch?" questions noticeably faster for the support team.
```

### Bad — what we're trying to avoid

```
Task closed by /jlu:close-task at 2026-04-29T13:59:15Z.

PRs merged:
- orchestrator-service #99 — merged 2026-04-28T14:54:38Z — https://...
- jelou-apps #5507 — merged 2026-04-29T13:27:08Z — https://...

All 3 phases done. 697 tests passing in orchestrator-service, 18/18 in
jelou-apps brain. Manual smoke (SC-3..SC-6, SC-8) pending post-deploy
verification.
```

This violates every rule above: signature, ISO timestamp, PR URLs, service
IDs in code form, test counts, phase counts, internal slugs.

## Source material

When composing the comment, the LLM has access to:

- `<TASK_DIR>/SPEC.md` — Problem Statement and Functional Requirements.
  This is the best source for the "what shipped" framing.
- `<TASK_DIR>/PROPOSAL.md` — Strategy section, useful for the user-visible
  framing.
- `<TASK_DIR>/TASKS.md` — Phase outcomes, deferred items (potential
  source for the follow-up paragraph).

Read these files first; do not rely on conversation context, since the
closure run may happen in a fresh session.
