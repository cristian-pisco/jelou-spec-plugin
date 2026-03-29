<!-- /autoplan restore point: /home/cristianp/.gstack/projects/cristian-pisco-jelou-spec-plugin/main-autoplan-restore-20260328-220009.md -->
# Update Notification System — Implementation Plan (Final)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Silently notify users when a newer version of jelou-spec-plugin is available, with a one-line banner on command startup.

**Architecture:** A single bash script (`bin/check-update.sh`) checks the GitHub Releases API (2s timeout, 4-hour cache). A shared reference document (`jelou/references/update-check.md`) describes the protocol. Each skill adds one line to Phase 1: "Run the update check." The check prints a silent banner, no interactive prompts.

**Tech Stack:** Bash (curl to GitHub Releases API), markdown skill instructions

**Fixes applied from CEO + Eng review:**
1. CI env var check instead of TTY guard (`[ -t 0 ]` always false in Claude Code Bash)
2. Releases API only, no tags fallback (halves worst-case latency)
3. `bin/` added to install.sh
4. Numeric version comparison on all paths (including cache hits)
5. `stat` fallback uses `date +%s` (treat as fresh, not expired)
6. `mktemp` for atomic cache writes
7. Skip-file mechanism removed (no UI to create it)

---

## File Map

| File | Action |
|------|--------|
| `bin/check-update.sh` | Create — version check script |
| `jelou/references/update-check.md` | Create — shared protocol |
| `bin/install.sh` | Modify — add bin/ to copy step |
| 12 `skills/*/SKILL.md` | Modify — add 1 line to Phase 1 |
| 5 skills without Bash | Modify — add Bash to allowed-tools |
| `CHANGELOG.md` | Modify — add entry |
| `README.md` | Modify — add update notification note |

---

### Task 1: Create the update check script

**Files:**
- Create: `bin/check-update.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# check-update.sh — Check GitHub Releases for newer plugin version.
# Output: "UPDATE_AVAILABLE <local> <remote>" (exit 0) or "SKIPPED"/"UP_TO_DATE" (exit 1)

# Skip in CI environments
if [ -n "${CI:-}" ] || [ -n "${GITHUB_ACTIONS:-}" ] || [ -n "${JENKINS_URL:-}" ] || [ -n "${BUILDKITE:-}" ] || [ -n "${CIRCLECI:-}" ]; then
  echo "SKIPPED"; exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
CACHE_FILE="${HOME}/.jlu-update-check"
CACHE_TTL=14400  # 4 hours
REPO="cristian-pisco/jelou-spec-plugin"

# Read local version
LOCAL_VERSION=$(grep -o '"version": "[^"]*"' "$PLUGIN_DIR/package.json" | head -1 | grep -o '[0-9]*\.[0-9]*\.[0-9]*')
[ -z "$LOCAL_VERSION" ] && { echo "SKIPPED"; exit 1; }

# Version comparison function
version_gt() {
  IFS='.' read -r L_MAJ L_MIN L_PAT <<< "$1"
  IFS='.' read -r R_MAJ R_MIN R_PAT <<< "$2"
  [ "$R_MAJ" -gt "$L_MAJ" ] 2>/dev/null && return 0
  [ "$R_MAJ" -eq "$L_MAJ" ] && [ "$R_MIN" -gt "$L_MIN" ] 2>/dev/null && return 0
  [ "$R_MAJ" -eq "$L_MAJ" ] && [ "$R_MIN" -eq "$L_MIN" ] && [ "$R_PAT" -gt "$L_PAT" ] 2>/dev/null && return 0
  return 1
}

# Check cache
if [ -f "$CACHE_FILE" ]; then
  NOW=$(date +%s)
  FILE_TIME=$(stat -c %Y "$CACHE_FILE" 2>/dev/null || stat -f %m "$CACHE_FILE" 2>/dev/null || echo "$NOW")
  CACHE_AGE=$(( NOW - FILE_TIME ))
  if [ "$CACHE_AGE" -lt "$CACHE_TTL" ]; then
    CACHED=$(cat "$CACHE_FILE")
    [ "$CACHED" = "SKIP" ] && { echo "SKIPPED"; exit 1; }
    [ "$CACHED" = "$LOCAL_VERSION" ] && { echo "UP_TO_DATE $LOCAL_VERSION"; exit 1; }
    if version_gt "$LOCAL_VERSION" "$CACHED"; then
      echo "UPDATE_AVAILABLE $LOCAL_VERSION $CACHED"
      exit 0
    fi
    echo "UP_TO_DATE $LOCAL_VERSION"
    exit 1
  fi
fi

# Query GitHub Releases API (2s timeout, single request)
REMOTE_VERSION=$(curl -sf --max-time 2 \
  "https://api.github.com/repos/$REPO/releases/latest" \
  2>/dev/null | grep -o '"tag_name": "[^"]*"' | grep -o '[0-9]*\.[0-9]*\.[0-9]*' || true)

# No response — cache SKIP
if [ -z "$REMOTE_VERSION" ]; then
  TMPF=$(mktemp "${CACHE_FILE}.XXXXXX") && echo "SKIP" > "$TMPF" && mv "$TMPF" "$CACHE_FILE" 2>/dev/null || true
  echo "SKIPPED"; exit 1
fi

# Cache remote version (atomic write)
TMPF=$(mktemp "${CACHE_FILE}.XXXXXX") && echo "$REMOTE_VERSION" > "$TMPF" && mv "$TMPF" "$CACHE_FILE" 2>/dev/null || true

# Compare
if version_gt "$LOCAL_VERSION" "$REMOTE_VERSION"; then
  echo "UPDATE_AVAILABLE $LOCAL_VERSION $REMOTE_VERSION"
  exit 0
fi

echo "UP_TO_DATE $LOCAL_VERSION"
exit 1
```

- [ ] **Step 2: Make executable and test**

```bash
chmod +x bin/check-update.sh
./bin/check-update.sh; echo "Exit: $?"
```

- [ ] **Step 3: Commit**

```bash
git add bin/check-update.sh
git commit -m "feat(update-check): add version check script against GitHub Releases API"
```

---

### Task 2: Create the update-check reference document

**Files:**
- Create: `jelou/references/update-check.md`

- [ ] **Step 1: Write the reference**

```markdown
# Update Check Protocol

> Shared protocol for all `/jlu:*` skills. Run after resolving the plugin root.

## Instructions

After resolving the plugin root directory, run:

\`\`\`bash
UPDATE_RESULT=$(<plugin-root>/bin/check-update.sh 2>/dev/null || echo "SKIPPED")
\`\`\`

- If the output starts with `UPDATE_AVAILABLE`: print a single line to the user:

  `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

  Do NOT use AskUserQuestion. Do NOT ask the user to decide. Just print the line and continue.

- If the output starts with `UP_TO_DATE` or `SKIPPED`: continue silently.

## Error Handling

- If `check-update.sh` does not exist: skip silently.
- If the script fails: skip silently. Never block the workflow.
```

- [ ] **Step 2: Commit**

```bash
git add jelou/references/update-check.md
git commit -m "docs(update-check): add shared update check protocol reference"
```

---

### Task 3: Add update check to all 12 skills + update install.sh

**Files:**
- Modify: 12 `skills/*/SKILL.md`
- Modify: `bin/install.sh`

- [ ] **Step 1: Add Bash to 5 skills that need it**

Add `- Bash` to allowed-tools in: `new-task`, `execute-task`, `refresh-skills`, `refine-task`. Verify `report-task` and `load-context` already have it.

- [ ] **Step 2: Add update check line to all 12 skills**

For each skill, append this line to the end of Phase 1 (after "If not found, stop with: ..."):

```markdown

After resolving the plugin root, run the update check protocol at `<plugin-root>/jelou/references/update-check.md`.
```

- [ ] **Step 3: Add bin/ to install.sh**

In `bin/install.sh`, add a new copy block after the skills copy:

```bash
# Copy bin scripts
if [ -d "$PLUGIN_DIR/bin" ]; then
  echo "Installing scripts..."
  mkdir -p "$CLAUDE_DIR/bin"
  cp "$PLUGIN_DIR/bin/check-update.sh" "$CLAUDE_DIR/bin/"
  chmod +x "$CLAUDE_DIR/bin/check-update.sh"
  echo "  Installed check-update.sh"
fi
```

- [ ] **Step 4: Commit**

```bash
git add skills/*/SKILL.md bin/install.sh
git commit -m "feat(skills): add silent update check to all 12 skill launchers"
```

---

### Task 4: Update documentation

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Add changelog entry**

Under `## [0.3.0]` → `### Added`:

```markdown
- **Update notifications** — Every `/jlu:*` command silently checks for newer versions on GitHub (cached 4h, 2s timeout). Prints a one-line banner if an update is available. Skips in CI environments.
```

- [ ] **Step 2: Add README note after "Updating the Plugin"**

```markdown
The plugin silently checks for updates when you run any `/jlu:*` command. If a newer version exists, you'll see a one-line notice with the update command. Checks are cached for 4 hours and skip in CI environments.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md README.md
git commit -m "docs: add update notification to changelog and README"
```

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR (via /autoplan) | 4 High addressed (interactive prompt, 12-file coupling, CI guard, platform risk) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (via /autoplan) | 1 CRITICAL (TTY guard), 2 HIGH (tags fallback, installer), 4 MEDIUM — all addressed |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | SKIPPED (no UI scope) | — |

**CROSS-MODEL:** CEO voices (4/6 confirmed) + Eng voices (6/6 confirmed). Both phases independently flagged TTY guard and latency as issues.
**UNRESOLVED:** 0
**VERDICT:** CEO + ENG CLEARED — ready to implement.
