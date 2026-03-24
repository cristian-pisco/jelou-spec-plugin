# Design: GitHub API Rate Limit Handling in create-pr Workflow

> **Date**: 2026-03-24
> **Status**: Approved
> **Scope**: `jelou/workflows/create-pr.md`

## Problem

The `/jlu:create-pr` workflow hits GitHub API rate limits when creating PRs for multi-service tasks (2-3+ services). The `gh` CLI commands fire back-to-back with no delay, triggering GitHub's secondary rate limits (abuse detection) even with low total request volume.

## Root Cause

GitHub enforces secondary rate limits that throttle rapid successive API calls regardless of remaining primary quota (5,000 req/hour). The workflow makes up to 3 API calls per service (`gh pr view`, `gh pr create`, `gh pr edit`) with zero delay between services, causing burst patterns that trigger these limits.

## Design

### 1. Retry Wrapper Protocol

A reusable retry protocol applied to all `gh` CLI commands in Steps 6, 7e, and 8.

**Parameters:**
- **Max retries**: 3 per `gh` command
- **Detection**: Check stderr/stdout for `rate limit`, `abuse detection`, `secondary rate limit`, HTTP 403, or HTTP 429
- **Backoff schedule**: 5s, 15s, 45s (exponential: `5 * 3^(attempt-1)`)
- **Logging**: On each retry, inform the user: "Rate limited by GitHub API. Retrying in Ns... (attempt M/3)"

**Bash pattern:**
```bash
for attempt in 1 2 3; do
  result=$(cd <SERVICE_CWD> && gh <command> 2>&1) && break
  if echo "$result" | grep -qi "rate limit\|abuse detection"; then
    sleep_time=$((5 * 3 ** (attempt - 1)))
    echo "Rate limited. Retrying in ${sleep_time}s (attempt $attempt/3)..."
    sleep "$sleep_time"
  else
    break  # Non-rate-limit error, don't retry
  fi
done
```

### 2. Inter-Service Throttle

**Step 3 change:** After completing Steps 4-7 for a service, wait 3 seconds before starting the next service iteration.

This prevents burst patterns across services while adding minimal overhead (3s per additional service).

### 3. Affected Steps

| Step | Command | Change |
|------|---------|--------|
| Step 3 | Service iteration loop | Add 3s delay between services |
| Step 6 | `gh pr view` | Wrap with retry protocol |
| Step 7e | `gh pr create` | Wrap with retry protocol |
| Step 8 | `gh pr edit` | Wrap with retry protocol |
| Step 7a | `git symbolic-ref` (local) | No change needed |

### 4. Error Handling Table Addition

| Error | Action |
|-------|--------|
| GitHub API rate limit | Auto-retry with exponential backoff (5s/15s/45s). After 3 failed retries, escalate to user: offer to wait 60s and retry, skip the service, or abort. |

### 5. Post-Exhaustion Escalation

When all 3 retries are exhausted for a command, present to the user:

```
GitHub API rate limit exceeded after 3 retries for <command> on <service-id>.

Options:
1. Wait 60 seconds and retry
2. Skip this service
3. Abort the entire operation
```

## What We're NOT Doing

- **No pre-flight rate limit check** — Adds an extra API call and the secondary limits aren't reflected in the quota endpoint.
- **No switch to `gh api`** — Unnecessary rewrite; `gh pr` commands are sufficient.
- **No caching** — The workflow is already idempotent; re-running is safe.
- **No parallel service processing** — Would increase burst rate and worsen the problem.

## Implementation

Changes are confined to a single file: `jelou/workflows/create-pr.md`. The modifications are:

1. Add a new section "GitHub API Rate Limit Handling" defining the retry protocol
2. Update Step 3 to include inter-service throttle
3. Update Steps 6, 7e, 8 to reference the retry protocol
4. Add rate limit row to the Error Handling table
