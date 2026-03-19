# TASKS: {{task-title}}

## Metadata

| Field | Value |
|-------|-------|
| **Slug** | {{task-slug}} |
| **Created** | {{dd-mm-yyyy}} |
| **Status** | draft |
| **Sprint** | {{sprint-number}} |
| **Execution Mode** | autonomous / step-by-step |

## Affected Services

| Service ID | Sub-State | Branch |
|-----------|-----------|--------|
| {{service-id}} | planned | spec/{{task-slug}} |

## Phase Progress

| # | Phase Name | Status | Started | Completed |
|---|-----------|--------|---------|-----------|
| 1 | {{phase-name}} | pending | — | — |
| 2 | {{phase-name}} | pending | — | — |

<!-- Status values: pending | in_progress | done | blocked -->

## Per-Service Progress

### {{service-id}}

| Phase | Status | Tests | Notes |
|-------|--------|-------|-------|
| 1 | pending | — | — |
| 2 | pending | — | — |

## Test Results Summary

### Unit Tests

| Service | Passed | Failed | Skipped | Coverage |
|---------|--------|--------|---------|----------|
| {{service-id}} | — | — | — | — |

### Integration Tests

| Service Pair | Passed | Failed | Notes |
|-------------|--------|--------|-------|
| — | — | — | — |

### E2E Tests

| Scenario | Status | Notes |
|----------|--------|-------|
| — | — | — |

## External Links

| Resource | URL |
|----------|-----|
| ClickUp Macro Task | {{clickup-url}} |
| PR ({{service-id}}) | {{pr-url}} |

## Timeline

| Timestamp | Event | Details |
|-----------|-------|---------|
| {{iso-timestamp}} | Task created | Initial draft |
