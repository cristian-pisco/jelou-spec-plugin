# Proposal: {{task-title}}

> Generated from SPEC.md by the proposal-agent. This document turns the user's need into an execution-ready plan so subagents do not have to invent the strategy on their own.

## Summary

### What
<!-- Brief description of what will be built or changed -->

### Why
<!-- Business justification and problem context from SPEC.md -->

## Affected Services

| Service ID | Role | Dependency Order |
|-----------|------|-----------------|
| {{service-id}} | {{primary/secondary}} | {{1-based order}} |

<!-- Dependency order determines execution sequence. Lower numbers execute first.
     Services with the same order number can execute in parallel. -->

## Global Strategy

<!-- Cross-service approach: how the services interact to fulfill the spec.
     For single-service tasks, describe the overall implementation strategy.
     For multi-service tasks, describe:
     - Contract boundaries between services
     - Communication patterns (sync/async, events, APIs)
     - Shared data models or schemas
     - Coordination points -->

## Phase Breakdown

### Phase 1: {{phase-name}}

**Objective**: <!-- What this phase achieves -->

**Requirements**:
- <!-- Requirement mapped from SPEC.md (reference FR-X / NFR-X) -->

**Services involved**: {{service-id-1}}, {{service-id-2}}

**Dependencies**: <!-- What must be complete before this phase starts -->

**Deliverables**:
- <!-- Concrete outputs of this phase -->

---

### Phase 2: {{phase-name}}

**Objective**: <!-- What this phase achieves -->

**Requirements**:
- <!-- Requirement mapped from SPEC.md (reference FR-X / NFR-X) -->

**Services involved**: {{service-id-1}}

**Dependencies**: Phase 1

**Deliverables**:
- <!-- Concrete outputs of this phase -->

---

<!-- Add more phases as needed. Each phase should be independently testable. -->

## Testing Strategy

### Unit Tests
<!-- Approach for unit testing across all affected services.
     What patterns, what coverage targets. -->

### Integration Tests
<!-- How services will be tested together.
     Contract testing, API testing, event testing. -->

### E2E Tests
<!-- End-to-end test scenarios when applicable.
     Maps to user stories and acceptance criteria. -->

## Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| {{risk-description}} | High/Medium/Low | High/Medium/Low | {{mitigation-strategy}} |

## User Stories Summary

| Story Slug | Description | Phase(s) |
|-----------|-------------|----------|
| {{story-slug}} | {{brief-description}} | {{phase-numbers}} |

<!-- Each story maps to one or more phases for traceability.
     Full story details live in uh/<story-slug>.md -->
