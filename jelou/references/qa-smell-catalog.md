# QA Smell Catalog

> Code smells and over-engineering patterns the `jlu-qa-agent` reviews during Final Validation. Read on demand — do not preload for per-phase reviews.
>
> For each finding: provide exact file path and line range, classify severity, include a one-line fix suggestion. Do not flag patterns that match the codebase's established architecture (check CONVENTIONS.md and ARCHITECTURE.md).

## Code Smell Detection

Review ALL new and modified files across all phases for structural issues:

- **God classes / large classes** — Any class with 300+ lines or 10+ methods likely has too many responsibilities. Identify which responsibilities should be extracted.
- **Long methods** — Any method exceeding 100 lines (per engineering principles). Also flag methods over 50 lines that do more than one thing.
- **Long parameter lists** — Functions with 5+ parameters. Suggest grouping into an options/config object.
- **Data clumps** — Groups of variables that appear together in multiple places (e.g., `startDate`/`endDate`/`timezone` passed around separately). Suggest encapsulating in a value object.
- **Feature envy** — Methods that use more data from another class than their own. The method probably belongs in the other class.
- **Inappropriate intimacy** — Modules reaching into another module's internals instead of using its public interface.
- **Dead code** — Unreachable branches, unused imports, commented-out code blocks, functions that are defined but never called.
- **Duplicated logic** — Same or very similar logic appearing in 2+ places across the implementation. Flag with both locations.

### Severity rules

- **HIGH** (blocks pipeline): god class 300+ lines, method 100+ lines, duplicated logic across 3+ locations.
- **MEDIUM** (logged, does not block): everything else — long params, data clumps, feature envy, dead code, duplicated logic in 2 locations.
- Do NOT flag issues that are consistent with patterns already established in the codebase.

## Over-Engineering Detection

Review ALL new and modified files for unnecessary complexity:

- **Single-implementation abstractions** — Interfaces or abstract classes with exactly one concrete implementation and no indication in the spec that more are expected. Unless the codebase convention requires it (e.g., NestJS providers), flag it.
- **Premature generalization** — Configuration options, extension points, or generic types that serve only one use case in the current implementation.
- **Unnecessary indirection** — Wrapper functions that add no logic, delegation chains where a direct call would suffice, service layers that just proxy to a repository.
- **Complex patterns for simple problems** — Full strategy/state patterns for 2 cases, factory patterns for single-type creation, event buses for point-to-point calls.
- **Speculative code** — Code paths that handle scenarios not in the spec and not tested (they're dead weight until proven needed).

### Severity rules

- **HIGH** (blocks pipeline): unnecessary indirection adding 50+ lines, complex pattern for a problem solvable in <10 lines.
- **MEDIUM**: single-implementation abstraction, premature generalization, speculative code.
- Do NOT flag patterns that match the codebase's established architecture.

## Coverage-Breadth Smells (Final Validation only)

A suite can be all-green and still production-thin — every test sends the same minimal happy-path payload. These are **presence-of-breadth** checks: read the test and fixture files; never run `--coverage` to satisfy them. **Derive the rejection space from the contract** (the DTO/validator surface), not only from what SPEC.md happens to mention.

- **Happy-path-only coverage** — A requirement (FR/SC) that validates or rejects input is backed only by valid-input tests; no test sends a violating payload and asserts a 4xx/error. **HIGH** when the FR has any validation rule (a typed/required/format/range decorator, on a body field or a typed query parameter) with no rejecting test.
- **Empty-collection-only fixtures** — A collection/array field is exercised only in its empty state (`[]`, `{}`, no rows) across all tests; the populated path is never asserted. **MEDIUM** (HIGH if the populated path is the production default).
- **Single-type / minimal payloads (payload realism)** — Tests for an entity with typed or reference fields only ever send the default/minimal shape (single text field, null references); no test populates a non-default field type or a cross-field reference (the boolean-column→options-filter→GUID shape that 400s in production). **MEDIUM.**

### Severity rules

- **HIGH** (blocks pipeline): a validated DTO field with at least one validation rule and no rejecting test.
- **MEDIUM**: empty-collection-only fixtures; single-type/minimal payloads where the populated path is not the production default.
- Do NOT flag patterns that match the codebase's established architecture.

## Report Tables

Use these structures in the Final Validation report:

```
### Code Smells
| ID | Smell | Location | Severity | Recommendation |
|----|-------|----------|----------|----------------|
| CS-1 | <smell type> | `src/file.ts:45-120` | HIGH/MEDIUM | <one-line fix> |

### Over-Engineering
| ID | Issue | Location | Severity | Simpler Alternative |
|----|-------|----------|----------|---------------------|
| OE-1 | <issue type> | `src/file.ts:10-80` | HIGH/MEDIUM | <simpler approach> |

### Coverage Breadth
| ID | Gap | Location | Severity | Missing case |
|----|-----|----------|----------|--------------|
| CB-1 | happy-path-only | `src/foo.dto.ts` validator vs `foo.spec.ts` | HIGH | string-into-`@IsNumber` rejection (400) |
```

## Examples

### Bad: flagging style preferences

```
| QA-1 | medium | Variable `userData` should be named `userDto` for consistency | `src/user.service.ts:42` |
```

CONVENTIONS.md says nothing about DTO naming in service internals. Personal preference, not a convention violation. Drop it.

### Good: flagging a real issue

```
| QA-1 | high | New endpoint `/api/users/:id` has no authentication guard. SPEC.md NFR-2 requires auth on all user endpoints. | `src/user.controller.ts:35-42` |
```

Specific location. Traces to a spec requirement. Actionable.

## The Principle

A QA report filled with style nits trains the team to ignore it. A QA report with 3 real issues trains the team to trust it. Report less, report better.
