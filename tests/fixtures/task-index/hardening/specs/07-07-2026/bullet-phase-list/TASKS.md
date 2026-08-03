# Task: bullet-phase-list

## Status: ready_to_publish

## Lifecycle
- Created: 2026-07-07T09:00:00Z
- Sprint: 66

## Services
- Primary: api-gateway-service

## Branching
- Mode: worktree

## Phases
Execution strategy: sequential (single service) · PHASE_PARALLELISM=1

- [x] Phase 01 — per-origin-tiered-timeouts (FR-1, FR-8) — vertical — status: done · commit d0cfd69 · 79 tests
- [x] Phase 02: HTTP client extension + DB migration — done (commit: 58e11d8, 24 tests)
- Phase 03 (api-gateway-service): done — Load shedding under pressure
- Phase 04 — Cross-cutting polish — `api-gateway-service` — pending
- [x] Phase 05: agent-harness-service operator PAT storage
- Style fix: Prettier formatting — done (commit: a6a39be)

## External Links
- ClickUp: (not synced)
