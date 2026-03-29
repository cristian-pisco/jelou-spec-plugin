# Template: Database Migration

## Description
Schema change with data transformation, rollback strategy, and zero-downtime deployment.

## Pre-filled Sections

### Problem Statement
<!-- FILL: Why does the schema need to change? What business need drives this? -->

### Functional Requirements
- FR-1: Schema changes — new tables, columns, indexes, constraints
- FR-2: Data transformation — how existing data maps to the new schema
- FR-3: Rollback DDL — exact SQL to undo the migration
- FR-4: Seed data — any reference data that must be inserted

### Non-Functional Requirements
- NFR-1: Zero-downtime deployment — migration must not lock tables for > 1 second
- NFR-2: Data integrity — no data loss during transformation
- NFR-3: Migration speed — estimated time for current data volume
- NFR-4: Backwards compatibility — old code must work during rollout window

### Constraints
- Must be reversible without data loss (up + down migrations)
- Must not exceed table lock thresholds for production data volume
- Must work with current ORM migration tooling

### Out of Scope
<!-- FILL: What schema changes are explicitly NOT part of this migration -->

### Success Criteria
- SC-1: Migration runs successfully on a copy of production data
- SC-2: Rollback restores the exact previous state
- SC-3: No table locks exceed 1 second during migration
- SC-4: Application continues serving requests during migration

## Interview Hints
- What's the current data volume for affected tables? (row count, table size)
- Is this additive (new column/table) or destructive (rename, drop, alter type)?
- Does old application code need to work with the new schema during deploy?
- What's the rollback strategy if migration fails halfway?
- Are there foreign key constraints that need to be handled in a specific order?
- Does the migration need to backfill data? If so, in batches or all at once?
- Are there any index changes that could cause long-running locks?
