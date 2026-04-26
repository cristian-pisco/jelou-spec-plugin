# ADR Template

> Reference shape for ADR files written to `<workspace>/decisions/ADR-NNNN-<slug>.md`.
> The grill agent emits files matching this shape; the orchestrator never touches an ADR body.

## File shape

```markdown
---
id: ADR-<NNNN>
slug: <kebab-case-slug>
title: <one-line title>
status: accepted | superseded | deprecated
date: <YYYY-MM-DD>
service: <service-id> | workspace
supersedes: ADR-<NNNN> | null
superseded_by: ADR-<NNNN> | null
tags: [<keyword>, ...]
---

# <Title>

## Context

<2–4 sentences. The architectural friction or proposal that prompted this decision. Use ARCH_VOCAB exactly: Module, Interface, Seam, Adapter, Depth, Leverage, Locality. Use DOMAIN_TERMS for concept names.>

## Decision

<2–3 sentences. What we decided to do — including "do nothing" / "reject the proposal" framings.>

## Consequences

<1–2 paragraphs. The trade-offs accepted. What this commits us to and what it forecloses.>

## Load-bearing reason for future explorers

<MUST be filled in for rejection ADRs. Phrased so a fresh explorer with no conversation context can read it and skip the candidate.>
```

## Field rules

- **`id`**: matches the filename's `ADR-NNNN-` prefix exactly. Allocated by the orchestrator (via `bin/architecture-review-allocate-adr.mjs`); the grill never invents a number.
- **`slug`**: kebab-case, ≤ 60 chars, derived from the title.
- **`status`**: defaults to `accepted`. Set to `superseded` only via a later ADR; the original ADR's `superseded_by` is updated by hand or by a future tool (out of scope for v1).
- **`service`**: `<service-id>` for single-service decisions, `workspace` for cross-service decisions. Used by the explorer to filter `EXISTING_ADRS` in single-service mode.
- **`supersedes` / `superseded_by`**: nullable; v1 does not enforce graph integrity.
- **`tags`**: optional keyword list for future search; v1 has no search command.

## Body rules

- **Context** uses ARCH_VOCAB exactly. No "component," "boundary," "API," or "service" (as module name).
- **Load-bearing reason for future explorers** is mandatory for rejection ADRs and may be omitted for acceptance ADRs (v1 only writes ADRs from rejection paths in the grill, but the field name is preserved for future acceptance ADRs).
