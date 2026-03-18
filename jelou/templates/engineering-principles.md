# Engineering Principles

> Project-specific principles that govern planning, implementation, and review
> across all services. Add principles here that are not derivable from code —
> cross-service constraints, compliance requirements, domain rules.
>
> These are injected into spec-interviewer, proposal, code, and QA agents.
>
> The plugin's built-in precedence (Security > Simplicity > Readability > TDD >
> Repo conventions) is always applied. Principles here extend — not replace — it.

## Project Principles

- Functions must not exceed 100 lines. If a function grows beyond this limit, refactor it into smaller, well-named units before proceeding.

<!-- Examples:
- All financial calculations must use Decimal, never floating point.
- Data access must be audit-logged (SOC2).
- No synchronous calls between services; use the event bus.
- API responses must include request-id for traceability.
-->
