# Template: Event Consumer

## Description
Async event consumer with idempotency, retry logic, and dead letter handling.

## Pre-filled Sections

### Problem Statement
<!-- FILL: What event does this consumer process and why? -->

### Functional Requirements
- FR-1: Event schema — fields, types, and versioning
- FR-2: Processing logic — what happens when the event is received
- FR-3: Idempotency — how duplicate events are detected and handled
- FR-4: Success criteria — how to determine the event was processed correctly
- FR-5: Side effects — what external calls or state changes occur during processing

### Non-Functional Requirements
- NFR-1: Retry strategy — max retries, backoff schedule, retry conditions
- NFR-2: Dead letter queue — where failed events go after max retries
- NFR-3: Ordering guarantees — does processing order matter? Per-key or global?
- NFR-4: Throughput — expected events per second, burst capacity
- NFR-5: Processing latency — max time from event publish to processing complete

### Constraints
- Must use existing message broker infrastructure
- Must be idempotent — reprocessing the same event produces the same result
- Must not block the consumer group on slow events

### Out of Scope
<!-- FILL: What event types or processing this consumer intentionally ignores -->

### Success Criteria
- SC-1: Duplicate events do not cause duplicate side effects
- SC-2: Failed events land in dead letter queue with full context
- SC-3: Consumer handles schema evolution (missing optional fields)
- SC-4: Processing meets latency target under expected throughput

## Interview Hints
- What message broker? (Kafka, RabbitMQ, SQS, Redis Streams, etc.)
- How is idempotency enforced? (idempotency key, dedup table, upsert)
- What happens if processing takes longer than the consumer timeout?
- Can events arrive out of order? If so, how is ordering handled?
- What's the dead letter strategy? Alert, retry later, manual intervention?
- Does the event schema have a version field? How are old versions handled?
- What monitoring/alerting is needed for consumer lag?
