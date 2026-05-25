#!/usr/bin/env bash
# format-changed-files.sh — host-side lint/format for the orchestrator's Step 7e / 7de.
#
# Detects the project's format command via a fixed priority chain and runs it
# only against the union of agent-declared changed files. Skips silently when
# nothing is detectable (e.g., Python/Go service with no convention noted).
#
# Inputs (env vars):
#   FORMAT_SOURCE_PATH    Absolute path to the service worktree/repo.
#   FORMAT_CHANGED_FILES  Newline-separated list of files to format
#                         (union of test-writer's Tests Written and implementer's
#                         Files Modified, or the tdd-cycle agent's combined list).
#   FORMAT_CONVENTIONS    (optional) Absolute path to CONVENTIONS.md. When set
#                         and the file exists, the script checks for an explicit
#                         "Format" or "Lint" command line and prefers it.
#   FORMAT_DRY_RUN        (optional) When "1", detects the command but does NOT
#                         execute it. Output includes detection_source and the
#                         command that would have been run. Used for tests.
#
# Output (stdout, key=value lines):
#   status=ok|skip|failed
#   command=<exact command run>   (only when status=ok or status=failed)
#   files_count=<N>               (only when status=ok)
#   reason=no_files|no_command_detected|format_failed
#
# Exit codes:
#   0 — formatting succeeded or skipped (no command available / no files)
#   1 — preflight failure (missing source path, not a git repo)
#   2 — format command failed (lint/prettier exit non-zero)
#
# All stderr output is human-readable diagnostics. Stdout is machine-parseable only.

set -euo pipefail

# ----- Input validation ---------------------------------------------------

: "${FORMAT_SOURCE_PATH:?FORMAT_SOURCE_PATH required}"
: "${FORMAT_CHANGED_FILES?FORMAT_CHANGED_FILES required (newline-separated file list — may be empty)}"

if [[ ! -d "$FORMAT_SOURCE_PATH" ]]; then
  echo "status=failed"
  echo "reason=source_path_missing"
  echo "ERROR: FORMAT_SOURCE_PATH does not exist: $FORMAT_SOURCE_PATH" >&2
  exit 1
fi

cd "$FORMAT_SOURCE_PATH"

# ----- Filter files --------------------------------------------------------

FILTERED=()
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  [[ -e "$file" ]] || continue
  FILTERED+=("$file")
done <<< "$FORMAT_CHANGED_FILES"

if [[ ${#FILTERED[@]} -eq 0 ]]; then
  echo "status=skip"
  echo "reason=no_files"
  exit 0
fi

# ----- Detect command -----------------------------------------------------

DETECTED_CMD=""
DETECTION_SOURCE=""

# 1. CONVENTIONS.md — look for an explicit format/lint command in fenced code.
if [[ -n "${FORMAT_CONVENTIONS:-}" ]] && [[ -f "$FORMAT_CONVENTIONS" ]]; then
  # Look for lines like: `npm run format -- ` or `npx prettier --write`
  # inside a section whose heading mentions Format or Lint.
  CONV_CMD="$(awk '
  # Activate inside Formatting/Lint sections (case-sensitive headings as before).
  /^#+ *(Format|Lint|Formatting|Linting)/ { in_section=1; next }
  in_section && /^#+ / { in_section=0 }
  # Scan every backtick token on the line — not just the first — so a config
  # filename mentioned before the real command does not shadow it.
  in_section {
    s = $0
    while (match(s, /`[^`]+`/)) {
      cmd = substr(s, RSTART+1, RLENGTH-2)
      s = substr(s, RSTART + RLENGTH)
      # Accept only actual commands. A command starts with a known runner /
      # formatter followed by whitespace and at least one argument. Bare config
      # filenames (`.prettierrc`, `biome.json`, `.eslintrc.json`) fail this test.
      if (cmd ~ /^(npm|npx|yarn|pnpm|bun|biome|prettier|eslint|rome|black|ruff|gofmt|rustfmt)[[:space:]]+[^[:space:]]/) {
        print cmd
        exit
      }
    }
  }
  ' "$FORMAT_CONVENTIONS" 2>/dev/null || true)"
  if [[ -n "$CONV_CMD" ]]; then
    DETECTED_CMD="$CONV_CMD"
    DETECTION_SOURCE="conventions"
  fi
fi

# 2. package.json scripts — prefer `format`, fall back to `lint:fix`.
if [[ -z "$DETECTED_CMD" ]] && [[ -f "package.json" ]]; then
  SCRIPT_NAME="$(node -e "
    const pkg = require('./package.json');
    const scripts = pkg.scripts || {};
    if (scripts.format) process.stdout.write('format');
    else if (scripts['lint:fix']) process.stdout.write('lint:fix');
  " 2>/dev/null || true)"
  if [[ -n "$SCRIPT_NAME" ]]; then
    DETECTED_CMD="npm run $SCRIPT_NAME --"
    DETECTION_SOURCE="package_script"
  fi
fi

# 3. JS/TS default — eslint --fix + prettier --write (only if package.json exists).
if [[ -z "$DETECTED_CMD" ]] && [[ -f "package.json" ]]; then
  if command -v npx >/dev/null 2>&1; then
    DETECTED_CMD="npx eslint --fix"
    DETECTION_SOURCE="default_eslint"
  fi
fi

if [[ -z "$DETECTED_CMD" ]]; then
  echo "status=skip"
  echo "reason=no_command_detected"
  echo "INFO: No format command detected for $FORMAT_SOURCE_PATH" >&2
  exit 0
fi

# ----- Run the command(s) -------------------------------------------------

# shellcheck disable=SC2086 # we want word-splitting of DETECTED_CMD
FULL_CMD="$DETECTED_CMD ${FILTERED[*]}"
FILES_COUNT=${#FILTERED[@]}

if [[ "${FORMAT_DRY_RUN:-}" == "1" ]]; then
  echo "status=ok"
  echo "command=$FULL_CMD"
  echo "detection_source=$DETECTION_SOURCE"
  echo "files_count=$FILES_COUNT"
  echo "dry_run=1"
  exit 0
fi

if ! eval "$FULL_CMD" >&2; then
  echo "status=failed"
  echo "command=$FULL_CMD"
  echo "reason=format_failed"
  echo "ERROR: Format command failed: $FULL_CMD" >&2
  exit 2
fi

# When using the JS/TS default, also run prettier as a second pass.
PRETTIER_RAN=""
if [[ "$DETECTION_SOURCE" == "default_eslint" ]] && command -v npx >/dev/null 2>&1; then
  PRETTIER_CMD="npx prettier --write ${FILTERED[*]}"
  if eval "$PRETTIER_CMD" >&2; then
    PRETTIER_RAN=" && $PRETTIER_CMD"
  fi
fi

echo "status=ok"
echo "command=$FULL_CMD$PRETTIER_RAN"
echo "detection_source=$DETECTION_SOURCE"
echo "files_count=$FILES_COUNT"
