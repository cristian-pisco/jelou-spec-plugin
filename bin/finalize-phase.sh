#!/usr/bin/env bash
# finalize-phase.sh — batched git ops for execute-task Step 7j.
#
# Consolidates pre-flight branch check, scope check, stage, commit,
# and rev-parse into one call so the orchestrator pays one Bash dispatch
# per phase instead of five.
#
# Inputs (env vars):
#   FINALIZE_SOURCE_PATH    Absolute path to the service worktree/repo.
#   FINALIZE_TASK_SLUG      Task slug — used to verify production/<slug> is current branch.
#   FINALIZE_PHASE_NN       Phase number (e.g., "01", "03a"). Used in commit body only.
#   FINALIZE_PHASE_TITLE    Phase title — used as commit subject body.
#   FINALIZE_SERVICE_ID     Service id — used as commit subject scope.
#   FINALIZE_COMMIT_TYPE    One of: feat | fix | docs | refactor | test.
#   FINALIZE_EXPECTED       Newline-separated list of declared files (test-writer + implementer artifacts).
#                           Known auto-staged manifests are appended internally; do not include them here.
#
# Output (stdout, key=value lines):
#   status=ok|abort
#   commit_sha=<short-sha>            (only when status=ok)
#   files_committed=<count>           (only when status=ok)
#   reason=<machine-readable>         (only when status=abort)
#   unexpected_files=<comma-separated> (only when status=abort with scope failure)
#
# Exit codes:
#   0  — commit landed successfully
#   1  — pre-flight failure (wrong branch, missing source path)
#   2  — scope check failed (unexpected files in diff)
#   3  — git stage/commit failed (e.g., pre-commit hook rejected)
#
# All stderr output is human-readable diagnostics. Stdout is machine-parseable only.

set -euo pipefail

# ----- Input validation ---------------------------------------------------

: "${FINALIZE_SOURCE_PATH:?FINALIZE_SOURCE_PATH required}"
: "${FINALIZE_TASK_SLUG:?FINALIZE_TASK_SLUG required}"
: "${FINALIZE_PHASE_NN:?FINALIZE_PHASE_NN required}"
: "${FINALIZE_PHASE_TITLE:?FINALIZE_PHASE_TITLE required}"
: "${FINALIZE_SERVICE_ID:?FINALIZE_SERVICE_ID required}"
: "${FINALIZE_COMMIT_TYPE:?FINALIZE_COMMIT_TYPE required}"
: "${FINALIZE_EXPECTED:?FINALIZE_EXPECTED required (newline-separated file list)}"

case "$FINALIZE_COMMIT_TYPE" in
  feat|fix|docs|refactor|test) ;;
  *)
    echo "status=abort" >&1
    echo "reason=invalid_commit_type" >&1
    echo "ERROR: FINALIZE_COMMIT_TYPE must be one of: feat|fix|docs|refactor|test (got: $FINALIZE_COMMIT_TYPE)" >&2
    exit 1
    ;;
esac

# ----- Pre-flight ----------------------------------------------------------

if [[ ! -d "$FINALIZE_SOURCE_PATH" ]]; then
  echo "status=abort"
  echo "reason=source_path_missing"
  echo "ERROR: FINALIZE_SOURCE_PATH does not exist: $FINALIZE_SOURCE_PATH" >&2
  exit 1
fi

cd "$FINALIZE_SOURCE_PATH"

if [[ ! -d ".git" ]] && ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "status=abort"
  echo "reason=not_a_git_repo"
  echo "ERROR: $FINALIZE_SOURCE_PATH is not a git working tree" >&2
  exit 1
fi

EXPECTED_BRANCH="production/$FINALIZE_TASK_SLUG"
CURRENT_BRANCH="$(git branch --show-current)"

if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "status=abort"
  echo "reason=wrong_branch"
  echo "expected_branch=$EXPECTED_BRANCH"
  echo "current_branch=$CURRENT_BRANCH"
  echo "ERROR: Expected branch $EXPECTED_BRANCH, got $CURRENT_BRANCH" >&2
  exit 1
fi

# ----- Scope check ---------------------------------------------------------

# Union of tracked-but-modified and untracked-but-not-ignored files.
# git diff --name-only HEAD alone misses brand-new files; ls-files --others
# captures them so new modules and test files are scoped and staged correctly.
DIFF_FILES="$( {
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } | LC_ALL=C sort -u )"

if [[ -z "$DIFF_FILES" ]]; then
  echo "status=abort"
  echo "reason=no_changes"
  echo "ERROR: No changes detected in $FINALIZE_SOURCE_PATH — nothing to commit" >&2
  exit 1
fi

# Known auto-staged manifests that hooks can touch independently of agent edits.
AUTO_STAGED=(
  "package.json"
  "package-lock.json"
  "yarn.lock"
  "pnpm-lock.yaml"
  "composer.lock"
  "poetry.lock"
  "Cargo.lock"
  "go.sum"
)

# Build the allowlist: expected files from agents + auto-staged manifests.
declare -A ALLOWED
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  ALLOWED["$line"]=1
done <<< "$FINALIZE_EXPECTED"

declare -A AUTO_STAGED_BASENAMES
for manifest in "${AUTO_STAGED[@]}"; do
  ALLOWED["$manifest"]=1
  AUTO_STAGED_BASENAMES["$manifest"]=1
done

# Validate every file in the diff is in the allowlist. Manifests are matched on
# basename so a service nested under the repo root (monorepo layout) is covered.
UNEXPECTED=()
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  if [[ -n "${ALLOWED[$file]:-}" ]]; then
    continue
  fi
  if [[ -n "${AUTO_STAGED_BASENAMES[${file##*/}]:-}" ]]; then
    continue
  fi
  UNEXPECTED+=("$file")
done <<< "$DIFF_FILES"

if [[ ${#UNEXPECTED[@]} -gt 0 ]]; then
  echo "status=abort"
  echo "reason=unexpected_files_in_diff"
  printf 'unexpected_files=%s\n' "$(IFS=','; echo "${UNEXPECTED[*]}")"
  echo "ERROR: Files in diff but not declared by any agent: ${UNEXPECTED[*]}" >&2
  exit 2
fi

# ----- Stage + commit ------------------------------------------------------

# Stage everything in the diff (we just validated it's all in scope).
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  git add "$file"
done <<< "$DIFF_FILES"

COMMIT_SUBJECT="${FINALIZE_COMMIT_TYPE}(${FINALIZE_SERVICE_ID}): ${FINALIZE_PHASE_TITLE}"
COMMIT_BODY="Phase ${FINALIZE_PHASE_NN} of production/${FINALIZE_TASK_SLUG}"

if ! git commit -m "$COMMIT_SUBJECT" -m "$COMMIT_BODY" >&2; then
  echo "status=abort"
  echo "reason=commit_failed"
  echo "ERROR: git commit failed for phase ${FINALIZE_PHASE_NN}" >&2
  exit 3
fi

COMMIT_SHA="$(git rev-parse --short HEAD)"
FILES_COMMITTED_COUNT="$(echo "$DIFF_FILES" | grep -c '^')"

echo "status=ok"
echo "commit_sha=$COMMIT_SHA"
echo "files_committed=$FILES_COMMITTED_COUNT"
