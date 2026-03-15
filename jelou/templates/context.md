# CONTEXT: {{service-id}} for {{task-slug}}

> Task-scoped context summarizing which parts of this service are relevant to the current task. This is a focused lens for code agents — distinct from the stable codebase knowledge files.

## Service ID
{{service-id}}

## Role in This Task
<!-- primary / secondary / support
     Describe what this service contributes to the task. -->

## Affected Modules / Directories

| Module / Directory | Purpose | Change Type |
|-------------------|---------|-------------|
| {{path}} | {{description}} | new / modified / refactored |

## Affected Endpoints / APIs

| Method | Path / Event | Description | Change Type |
|--------|-------------|-------------|-------------|
| {{GET/POST/EVENT}} | {{endpoint-or-event}} | {{description}} | new / modified |

## Affected Models / Schemas

| Model / Schema | Location | Change Type | Details |
|---------------|----------|-------------|---------|
| {{model-name}} | {{file-path}} | new / modified | {{what changes}} |

## Configuration Changes Needed

| Config File | Key / Section | Change | Reason |
|------------|---------------|--------|--------|
| {{file}} | {{key}} | {{description}} | {{why}} |

## Dependencies on Other Services (for This Task)

| Service ID | Dependency Type | Details |
|-----------|----------------|---------|
| {{other-service}} | {{API call / event / shared schema}} | {{description}} |

<!-- This section captures task-specific inter-service dependencies.
     For stable integration patterns, see the service's INTEGRATIONS.md. -->
