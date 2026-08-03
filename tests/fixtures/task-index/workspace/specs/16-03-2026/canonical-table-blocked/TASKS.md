---
affected_services:
  - id: memory-engine
    sub_state: planned
    branch: spec/canonical-table-blocked
---

# TASKS: user memory endpoints

## Metadata

| Field | Value |
|-------|-------|
| **Slug** | canonical-table-blocked |
| **Created** | 16-03-2026 |
| **Status** | implementing |
| **Sprint** | 58 |

## Status: implementing

## Lifecycle
- Created: 2026-03-16T09:00:00Z
- Planned: 2026-03-17T10:30:00Z
- Implementing: 2026-03-18T00:30:00Z
- Sprint: 58

## Branching
- Mode: worktree

## Affected Services

| Service ID | Sub-State | Branch |
|-----------|-----------|--------|
| memory-engine | done | spec/canonical-table-blocked |
| memory-proxy | implementing | spec/canonical-table-blocked |

## Phase Progress

| # | Phase Name | Status | Started | Completed |
|---|-----------|--------|---------|-----------|
| 1 | memory-engine: Endpoint Implementation | done | 2026-03-18T00:30:00Z | 2026-03-18T00:45:00Z |
| 2 | memory-engine: Tests | done | 2026-03-18T00:30:00Z | 2026-03-18T00:45:00Z |
| 3 | memory-proxy: Proxy + Controller | blocked | 2026-03-18T00:45:00Z | — |
| 4 | memory-proxy: Tests + Cleanup | pending | — | — |

## External Links

| Resource | URL |
|----------|-----|
| ClickUp Macro Task | https://app.clickup.com/t/86c1abcde |
| PR (memory-engine) | https://github.com/ExampleOrg/memory-engine/pull/1841 |

- ClickUp: 86c1abcde
- PR (memory-proxy): https://github.com/ExampleOrg/memory-proxy/pull/977
