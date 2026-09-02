#!/usr/bin/env bash
# format-changed-files.sh — host-side lint/format for the orchestrator's Step 7e / 7de.
#
# Detects the project's format command via a fixed priority chain and runs it
# only against the union of agent-declared changed files. Skips silently when
# nothing is detectable (e.g., a Python/Go service with no package.json).
#
# Inputs (env vars):
#   FORMAT_SOURCE_PATH    Absolute path to the service worktree/repo.
#   FORMAT_CHANGED_FILES  Newline-separated list of files to format
#                         (union of test-writer's Tests Written and implementer's
#                         Files Modified, or the tdd-cycle agent's combined list).
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

# FORMAT_CHANGED_FILES is the agent-declared "Files Modified" list -- the
# untrusted side of a prompt-injection boundary. Two things must hold for every
# entry before it becomes a formatter argument:
#   1. it stays inside FORMAT_SOURCE_PATH (no absolute paths, no ../ escape), so
#      a declared path can never make the formatter rewrite a file outside the
#      service worktree;
#   2. it is passed after a `--` end-of-options marker and prefixed with ./ when
#      it starts with a dash, so a file named `--config=evil.js` is an operand
#      and not an option (eslint and prettier both load JS config from --config,
#      which would be arbitrary code execution).
SOURCE_ROOT=$(pwd -P)
FILTERED=()
SKIPPED_OUTSIDE=0
while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  [[ -e "$file" ]] || continue
  resolved=$(cd "$(dirname -- "$file")" 2>/dev/null && printf '%s/%s' "$(pwd -P)" "$(basename -- "$file")") || { SKIPPED_OUTSIDE=$((SKIPPED_OUTSIDE + 1)); continue; }
  if [[ "$resolved" != "$SOURCE_ROOT/"* ]]; then
    SKIPPED_OUTSIDE=$((SKIPPED_OUTSIDE + 1))
    echo "WARN: refusing to format a path outside $SOURCE_ROOT: $file" >&2
    continue
  fi
  [[ "$file" == -* ]] && file="./$file"
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
# CMD_ARGV is the executable form; DETECTED_CMD is only ever displayed. Keeping
# them separate is what lets us run the formatter without `eval`, so a changed
# file whose name contains shell metacharacters (`a;id;b.js`) is passed as one
# argv element instead of being interpreted as shell.
CMD_ARGV=()

# 1. package.json scripts — prefer `format`, fall back to `lint:fix`.
if [[ -f "package.json" ]]; then
  SCRIPT_NAME="$(node -e "
    const pkg = require('./package.json');
    const scripts = pkg.scripts || {};
    if (scripts.format) process.stdout.write('format');
    else if (scripts['lint:fix']) process.stdout.write('lint:fix');
  " 2>/dev/null || true)"
  if [[ -n "$SCRIPT_NAME" ]]; then
    DETECTED_CMD="npm run $SCRIPT_NAME --"
    CMD_ARGV=(npm run "$SCRIPT_NAME" --)
    DETECTION_SOURCE="package_script"
  fi
fi

# 2. JS/TS default — eslint --fix + prettier --write (only if package.json exists).
if [[ -z "$DETECTED_CMD" ]] && [[ -f "package.json" ]]; then
  if command -v npx >/dev/null 2>&1; then
    DETECTED_CMD="npx eslint --fix"
    CMD_ARGV=(npx eslint --fix)
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

# Display-only rendering of what we are about to run. The real invocation below
# uses the CMD_ARGV array, never this string.
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

declare -A PRE_SUM
for f in "${FILTERED[@]}"; do
  PRE_SUM["$f"]="$(md5sum -- "$f" | cut -d' ' -f1)"
done

if ! "${CMD_ARGV[@]}" -- "${FILTERED[@]}" >&2; then
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
  if npx prettier --write -- "${FILTERED[@]}" >&2; then
    PRETTIER_RAN=" && $PRETTIER_CMD"
  fi
fi

CHANGED_BY_FORMAT=0
for f in "${FILTERED[@]}"; do
  [[ -e "$f" ]] || continue
  POST_SUM="$(md5sum -- "$f" | cut -d' ' -f1)"
  if [[ "$POST_SUM" != "${PRE_SUM[$f]}" ]]; then
    CHANGED_BY_FORMAT=$((CHANGED_BY_FORMAT + 1))
  fi
done

echo "status=ok"
echo "command=$FULL_CMD$PRETTIER_RAN"
echo "detection_source=$DETECTION_SOURCE"
echo "files_count=$FILES_COUNT"
echo "changed_by_format=$CHANGED_BY_FORMAT"
