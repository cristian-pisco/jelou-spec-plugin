# Create-PR Rate Limit Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub API rate-limit retry logic and inter-service throttling to the create-pr workflow.

**Architecture:** All changes are to a single workflow spec file (`jelou/workflows/create-pr.md`). We add a new section defining a reusable retry protocol, update three existing steps to reference it, add an inter-service throttle to the service loop, and extend the error handling table.

**Tech Stack:** Markdown (workflow spec document)

**Spec:** `docs/superpowers/specs/2026-03-24-create-pr-rate-limit-handling-design.md`

---

### Task 1: Add "GitHub API Rate Limit Handling" section

**Files:**
- Modify: `jelou/workflows/create-pr.md` (insert new section between the header block and Step 1)

- [ ] **Step 1: Insert the rate limit handling section after the Tool requirement note, before the first `---`**

Insert the following between the `> **Tool requirement**` note and the first `---` separator:

```markdown

---

## GitHub API Rate Limit Handling

All `gh` CLI commands in this workflow (Steps 6, 7e, 8) MUST use the retry protocol below.

### Retry Protocol

**Parameters:**
- **Max retries**: 3 per `gh` command (retries numbered 1–3; the initial attempt is attempt 0)
- **Detection**: Check stderr/stdout for `rate limit`, `abuse detection`, `HTTP 403`, or `HTTP 429`
- **Backoff schedule**: 5s, 15s, 45s (exponential: `5 * 3^(retry-1)`)
- **Logging**: On each retry, inform the user: "Rate limited by GitHub API. Retrying in Ns... (retry M/3)"

**Bash pattern:**
~~~bash
rate_limit_hit=false
for attempt in 0 1 2 3; do
  if [ "$attempt" -gt 0 ]; then
    sleep_time=$((5 * 3 ** (attempt - 1)))
    echo "Rate limited. Retrying in ${sleep_time}s (retry $attempt/3)..."
    sleep "$sleep_time"
  fi
  result=$(cd <SERVICE_CWD> && gh <command> 2>&1) && { rate_limit_hit=false; break; }
  if echo "$result" | grep -qi "rate limit\|abuse detection\|HTTP 403\|HTTP 429"; then
    rate_limit_hit=true
  else
    rate_limit_hit=false
    break  # Non-rate-limit error, don't retry
  fi
done

# Post-exhaustion escalation (Steps 6 and 7e only)
if [ "$rate_limit_hit" = true ]; then
  # Present escalation options to user — see "Post-Exhaustion Escalation" below
fi
~~~

### Post-Exhaustion Escalation

When all 3 retries are exhausted for a `gh` command in **Steps 6 or 7e**, present to the user:

```
GitHub API rate limit exceeded after 3 retries for <command> on <service-id>.

Options:
1. Wait 60 seconds and retry
2. Skip this service
3. Abort the entire operation
```

For **Step 8** (`gh pr edit`), on exhaustion: warn "Cross-reference update for <service-id> failed due to rate limit — skipping (non-critical)" and continue to the next service.
```

- [ ] **Step 2: Verify the new section reads correctly**

Read `jelou/workflows/create-pr.md` and confirm the new section appears between the header and Step 1, with proper markdown formatting.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/create-pr.md
git commit -m "Add rate limit retry protocol section to create-pr workflow"
```

---

### Task 2: Add inter-service throttle to Step 3

**Files:**
- Modify: `jelou/workflows/create-pr.md` (Step 3 section)

- [ ] **Step 1: Update Step 3 to include the throttle instruction**

After the `}` line that closes the `PR_RESULTS` code block in Step 3, before the `---` that separates Step 3 from Step 4, add:

```markdown

**Rate limit throttle**: After completing Steps 4–7 for a service, wait 3 seconds before starting the next service iteration. The delay fires only between services, not after the final service in the loop.
```

- [ ] **Step 2: Verify Step 3 reads correctly**

Read the Step 3 section and confirm the throttle instruction appears after the PR_RESULTS map.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/create-pr.md
git commit -m "Add inter-service throttle to Step 3 of create-pr workflow"
```

---

### Task 3: Wrap Steps 6, 7e, and 8 with retry protocol references

**Files:**
- Modify: `jelou/workflows/create-pr.md` (Steps 6, 7e, and 8)

- [ ] **Step 1: Update Step 6 — add retry note after the bash command**

After the `gh pr view` bash block (the block containing `gh pr view spec/<TASK_SLUG> --json url,state,title,number 2>&1`), before "Parse the result:", add:

```markdown

> **Rate limit**: Apply the retry protocol (see "GitHub API Rate Limit Handling" above). On exhaustion, escalate to user.

```

- [ ] **Step 2: Update Step 7e — add retry note after the bash command**

After the `gh pr create` bash block (the block ending with `)"` after the PR_BODY heredoc), before "Parse the output to extract the PR URL", add:

```markdown

> **Rate limit**: Apply the retry protocol (see "GitHub API Rate Limit Handling" above). On exhaustion, escalate to user.

```

- [ ] **Step 3: Update Step 8 — add retry note after the bash command**

After the `gh pr edit` bash block (the block containing `gh pr edit <NUMBER> --body`), replace the line "If updating fails, warn but continue — cross-references are non-critical." with:

```markdown
> **Rate limit**: Apply the retry protocol (see "GitHub API Rate Limit Handling" above). On exhaustion, warn "Cross-reference update for <service-id> failed due to rate limit — skipping (non-critical)" and continue. Non-rate-limit failures also warn and continue — cross-references are non-critical.
```

- [ ] **Step 4: Verify all three steps read correctly**

Read Steps 6, 7e, and 8 and confirm each has the retry protocol reference in the right place.

- [ ] **Step 5: Commit**

```bash
git add jelou/workflows/create-pr.md
git commit -m "Add retry protocol references to Steps 6, 7e, and 8"
```

---

### Task 4: Update Error Handling table

**Files:**
- Modify: `jelou/workflows/create-pr.md` (Error Handling section)

- [ ] **Step 1: Add rate limit row to the error handling table**

Insert a new row **before** the `| PR creation fails |` row. The rate-limit row is a more specific case that takes precedence:

```markdown
| GitHub API rate limit | Auto-retry with exponential backoff (5s/15s/45s). After 3 failed retries, escalate to user: offer to wait 60s and retry, skip the service, or abort. |
```

The table should now read:
```markdown
| Error | Action |
|-------|--------|
| No task found | Stop with message |
| Task is closed | Stop with message |
| Task in draft/refining | Warn, ask user to confirm |
| `gh` CLI not installed or not authenticated | Stop: "GitHub CLI (`gh`) is required. Install it and run `gh auth login`." |
| No commits ahead of default branch | Warn, ask user — skip or abort |
| Git-agent escalation | Present to user, offer skip/retry/abort |
| GitHub API rate limit | Auto-retry with exponential backoff (5s/15s/45s). After 3 failed retries, escalate to user: offer to wait 60s and retry, skip the service, or abort. |
| PR creation fails | Report error, ask user to retry or skip service |
| Cross-reference update fails | Warn, continue |
| CLICKUP_TASK.json write fails | Warn, continue |
```

- [ ] **Step 2: Verify the table reads correctly**

Read the Error Handling section and confirm the new row appears before "PR creation fails" and the table is well-formatted.

- [ ] **Step 3: Commit**

```bash
git add jelou/workflows/create-pr.md
git commit -m "Add rate limit error row to create-pr error handling table"
```

---

### Task 5: Final verification

- [ ] **Step 1: Read the entire file end-to-end**

Read `jelou/workflows/create-pr.md` from top to bottom and verify:
1. The "GitHub API Rate Limit Handling" section appears between the header and Step 1
2. Step 3 has the inter-service throttle instruction
3. Steps 6, 7e, and 8 each reference the retry protocol
4. The Error Handling table has the rate limit row before "PR creation fails"
5. No formatting issues, broken markdown, or duplicate content

- [ ] **Step 2: Verify consistency with the design spec**

Cross-check against `docs/superpowers/specs/2026-03-24-create-pr-rate-limit-handling-design.md` to confirm all 4 implementation items from the spec are addressed.
