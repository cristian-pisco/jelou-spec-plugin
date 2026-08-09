# Subagent Summary Contract

> Internal communication contract between subagents and the orchestrator (Section 11.6). This defines the structured JSON format that every subagent must emit when reporting status, and the rules governing when and how summaries are produced.

## Contract Overview

- **Format**: JSON structured
- **Schema**: Same schema for both incremental updates and final closure
- **Frequency**: Emitted at least once at the end of each delegation. May be emitted more frequently for long-running tasks.
- **Persistence**: Runtime-only. Summaries are not persisted to disk — they exist only in the agent communication channel. Persistent state is written to TASKS.md and phase files.

## Schema

```json
{
  "agent": "<agent-role>",
  "task": "<task-slug>",
  "service": "<service-id>",
  "status": "<pending | in_progress | success | blocked | failed>",
  "outcome": "<human-readable summary of what was accomplished or what went wrong>",
  "risks": [
    {
      "description": "<risk description>",
      "severity": "<low | medium | high | critical>",
      "mitigation": "<suggested mitigation or null>"
    }
  ],
  "next_actions": [
    {
      "action": "<what needs to happen next>",
      "owner": "<agent-role | orchestrator | user>"
    }
  ],
  "artifacts": [
    "<relative path to created/modified file>"
  ]
}
```

## Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent` | string | yes | The role of the reporting agent (e.g., `test-writer`, `implementer`, `build-validator`, `proposal-agent`). |
| `task` | string | yes | The task slug this work belongs to. |
| `service` | string | yes | The service ID the agent was working on. Use `"global"` for agents working across services (e.g., proposal-agent global pass). |
| `status` | enum | yes | Current status: `pending` (not started), `in_progress` (still working), `success` (completed successfully), `blocked` (cannot continue), `failed` (completed with errors). |
| `outcome` | string | yes | Human-readable summary of what happened. Should be concise but complete enough for the orchestrator to decide next steps without reading the agent's full output. |
| `risks` | array | yes | Identified risks. Empty array `[]` if none. Each risk includes severity and optional mitigation. |
| `risks[].severity` | enum | yes | Risk severity: `low`, `medium`, `high`, `critical`. Critical risks always trigger user notification. |
| `next_actions` | array | yes | What needs to happen next. Empty array `[]` if the delegation is fully complete with no follow-up. Owner indicates who should take the action. |
| `artifacts` | array | yes | Paths to files created or modified during this delegation. Empty array `[]` if no file changes. Paths are relative to the service repo root. |

## Status Values

| Status | Meaning | Orchestrator Response |
|--------|---------|----------------------|
| `pending` | Agent has not started work | Wait or re-delegate |
| `in_progress` | Agent is actively working (interim update) | Continue monitoring |
| `success` | Agent completed its delegation successfully | Proceed to next step in the workflow |
| `blocked` | Agent cannot continue without external input | Escalate: resolve blocker or involve user |
| `failed` | Agent encountered an unrecoverable error | Kill agent, spawn fresh agent with failure summary |

## Examples

### Test-Writer Success

```json
{
  "agent": "test-writer",
  "task": "add-user-auth",
  "service": "service-auth",
  "status": "success",
  "outcome": "Wrote 12 unit tests for JWT token generation and validation. All tests fail as expected (Red phase). Covers success paths (valid token, refresh token), error paths (expired token, invalid signature, missing claims), and edge cases (empty string, malformed JWT, concurrent refresh).",
  "risks": [],
  "next_actions": [
    {
      "action": "Spawn implementer agent to make tests pass (Green phase)",
      "owner": "orchestrator"
    }
  ],
  "artifacts": [
    "src/auth/token.service.spec.ts",
    "src/auth/token-refresh.service.spec.ts"
  ]
}
```

### Implementer Blocked (Suspected Test Defect)

```json
{
  "agent": "implementer",
  "task": "add-user-auth",
  "service": "service-auth",
  "status": "blocked",
  "outcome": "9 of 12 tests passing. 3 tests appear to have incorrect assertions: they expect synchronous token validation but the existing auth middleware uses async verification. The tests contradict the established pattern in CONVENTIONS.md.",
  "risks": [
    {
      "description": "Test assertions may not match the actual service architecture",
      "severity": "medium",
      "mitigation": "Escalate with spec-vs-test evidence per systematic-debugging.md; do not attempt a 4th fix"
    }
  ],
  "next_actions": [
    {
      "action": "Apply the three-strike escalation flow: present the spec-vs-test evidence to the orchestrator for a retry/escalation decision",
      "owner": "orchestrator"
    }
  ],
  "artifacts": [
    "src/auth/token.service.ts"
  ]
}
```

### Build Validation Success

```json
{
  "agent": "build-validator",
  "task": "add-user-auth",
  "service": "service-auth",
  "status": "success",
  "outcome": "Build green after 1 auto-fix round: a missing type import in token.service.ts. No further compile errors.",
  "risks": [],
  "next_actions": [],
  "artifacts": [
    "src/auth/token.service.ts"
  ]
}
```

## Orchestrator Consolidation

The orchestrator uses subagent summaries to:

1. **Update TASKS.md** — Write progress updates, test results, and timeline events.
2. **Update phase files** — Record agent output, artifacts, and deviations in the Execution section.
3. **Decide next steps** — Route to the next agent, escalate to user, or trigger state transitions.
4. **Generate reports** — Consolidate summaries across agents and services for the execution summary.
5. **Detect patterns** — Multiple `blocked` or `failed` statuses may indicate a systemic issue requiring user attention.

The orchestrator never writes code or tests — it only delegates, consolidates, evaluates, and summarizes (Section 11.2).
