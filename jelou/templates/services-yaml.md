# services.yaml Schema Reference

> The service registry lives at `.spec-workspace/registry/services.yaml`. It uses a minimal schema (Decision #11: Layered discovery) — only `id`, `path`, and `stack`. Detailed inter-service relationships are discovered dynamically by reading each service's `INTEGRATIONS.md`.

## Schema

```yaml
services:
  - id: {{service-id}}
    path: {{relative-path}}
    stack: {{stack-name}}
```

## Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique service identifier. Convention: `service-<name>` (e.g., `service-auth`, `service-payments`). |
| `path` | string | yes | Relative path from `.spec-workspace/` to the service repo root (e.g., `../service-auth`). |
| `stack` | string | yes | Primary technology stack. One of the supported stacks (e.g., `nestjs`, `laravel`, `react`, `go`, `rust`, `nextjs`, `vue`, `angular`). |

## Example

```yaml
services:
  - id: service-auth
    path: ../service-auth
    stack: nestjs

  - id: service-frontend
    path: ../service-frontend
    stack: react

  - id: service-payments
    path: ../service-payments
    stack: laravel
```

## Notes

- The registry is the single source of truth for which services exist in the workspace.
- Paths are relative to the `.spec-workspace/` directory.
- Relationships between services (API calls, events, shared schemas) are not stored here. They are discovered by reading each service's `INTEGRATIONS.md` under `.spec-workspace/services/<service-id>/codebase/`.
- If a spec or codebase doc references a service not in the registry, the plugin warns and offers to register it (Decision #39).
