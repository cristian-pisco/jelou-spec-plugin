#!/usr/bin/env bash
# classify-phase.sh — consolidates the 3 phase classifiers used by execute-task
# Steps 7c.1, 7e, and 8a.5.
#
# Invoked with a subcommand as the first positional arg:
#   classify-phase.sh mode         (Step 7c.1: docs | tdd)
#   classify-phase.sh trivial      (Step 7e: trivial yes/no, with safety override)
#   classify-phase.sh all          (mode + trivial in one invocation)
#   classify-phase.sh compilable   (Step 8a.5:  compilable source file present yes/no)
#
# Output (stdout, key=value lines) is subcommand-specific. See each subcommand
# for the full schema. `all` emits both key sets, renaming `reason` to
# `mode_reason` and `trivial_reason`, and derives CLASSIFY_FRONTMATTER_TRIVIAL
# from its own mode pass.
#
# Contract: the TRIVIAL keys are a size gate over `git diff HEAD`, so they are
# only meaningful when CLASSIFY_SOURCE_PATH already carries the phase's diff.
# On a clean tree they report trivial=true. execute-task reads only the mode
# keys from `all` at Step 7c.1 and calls `trivial` at Step 7e, post-Green.
#
# Exit codes:
#   0 — classification produced a definitive result
#   1 — input validation error
#   2 — subcommand-specific failure (e.g., docs override rejected)
#
# All stderr output is human-readable diagnostics. Stdout is machine-parseable only.

set -euo pipefail

SUBCOMMAND="${1:-}"
if [[ -z "$SUBCOMMAND" ]]; then
  echo "ERROR: subcommand required (mode|trivial|all|compilable)" >&2
  exit 1
fi

# Non-compilable extension allowlist (Step 8a.5).
NON_COMPILABLE_EXTS=(
  md mdx txt rst
  yaml yml toml ini env example
  css scss sass less html htm svg
  png jpg jpeg gif webp ico pdf
)

# Code-change verbs that disqualify a phase from docs mode.
CODE_CHANGE_VERBS=(
  implement
  "add endpoint"
  wire
  inject
  migrate
  handler
  controller
  service
  module
)

# Documentation file patterns for docs-mode Files Modified validation.
DOC_FILE_PATTERNS=(
  '\.md$'
  '\.mdx$'
  '\.txt$'
  '\.rst$'
  'README'
  'CHANGELOG'
  '^docs/'
  '/docs/'
  'verification\.md$'
)

# ===========================================================================
# Subcommand: mode
# ===========================================================================
compute_mode() {
  : "${CLASSIFY_PHASE_FILE:?CLASSIFY_PHASE_FILE required (path to phase markdown)}"
  : "${CLASSIFY_SERVICES_IN_PHASE:?CLASSIFY_SERVICES_IN_PHASE required (integer)}"

  if [[ ! -f "$CLASSIFY_PHASE_FILE" ]]; then
    echo "ERROR: phase file not found: $CLASSIFY_PHASE_FILE" >&2
    exit 1
  fi

  # Count FR/NFR top-level bullets.
  FR_NFR_COUNT="$(grep -cE '^[[:space:]]*[-*][[:space:]]+\*{0,2}(FR|NFR)-[0-9]+' "$CLASSIFY_PHASE_FILE" || true)"

  # Detect frontmatter mode override. Accept either:
  #   - `**Mode: docs**` / `**Mode: vertical**` / `**Mode: horizontal**` / `**Mode: trivial**` line
  #   - YAML frontmatter `mode: docs` between `---` fences (top of file)
  OVERRIDE=""
  if line="$(grep -m1 -E '^\*\*Mode:\s*(docs|vertical|horizontal|trivial)\*\*' "$CLASSIFY_PHASE_FILE" 2>/dev/null)"; then
    OVERRIDE="$(echo "$line" | sed -E 's/^\*\*Mode:\s*([a-z]+)\*\*.*/\1/')"
  elif line="$(awk '/^---$/{f++;next} f==1 && /^mode:/{print;exit}' "$CLASSIFY_PHASE_FILE" 2>/dev/null)"; then
    OVERRIDE="$(echo "$line" | sed -E 's/^mode:[[:space:]]*([a-z]+).*/\1/')"
  fi

  # If override is docs, validate the requirements section.
  DOCS_VALIDATION="n/a"
  DOCS_REJECTION_REASON=""
  if [[ "$OVERRIDE" == "docs" ]]; then
    REQ_SECTION="$(awk '/^## Requirements/{f=1;next} f && /^## /{exit} f' "$CLASSIFY_PHASE_FILE" 2>/dev/null)"
    FOUND_VERB=""
    for verb in "${CODE_CHANGE_VERBS[@]}"; do
      if echo "$REQ_SECTION" | grep -iqE "(^|[^a-zA-Z])$verb([^a-zA-Z]|$)"; then
        FOUND_VERB="$verb"
        break
      fi
    done
    if [[ -n "$FOUND_VERB" ]]; then
      DOCS_VALIDATION="failed"
      DOCS_REJECTION_REASON="found_code_change_verb:$FOUND_VERB"
    else
      DOCS_VALIDATION="passed"
    fi
  fi

  if [[ "$OVERRIDE" == "docs" ]] && [[ "$DOCS_VALIDATION" == "passed" ]]; then
    MODE="docs"
    MODE_REASON="frontmatter_override_validated"
  elif [[ "$OVERRIDE" == "docs" ]]; then
    MODE="tdd"
    MODE_REASON="docs_override_rejected"
  elif [[ "$OVERRIDE" == "vertical" ]] || [[ "$OVERRIDE" == "horizontal" ]]; then
    MODE="tdd"
    MODE_REASON="legacy_mode_override"
    echo "note: legacy Mode: $OVERRIDE treated as tdd (vertical/horizontal retired)" >&2
  else
    MODE="tdd"
    MODE_REASON="default"
  fi
}

emit_mode() {
  local reason_key="$1"
  echo "mode=$MODE"
  echo "fr_nfr_count=$FR_NFR_COUNT"
  echo "frontmatter_override=${OVERRIDE:-none}"
  echo "docs_validation=$DOCS_VALIDATION"
  if [[ -n "$DOCS_REJECTION_REASON" ]]; then
    echo "docs_rejection_reason=$DOCS_REJECTION_REASON"
  fi
  echo "$reason_key=$MODE_REASON"
}

classify_mode() {
  compute_mode
  emit_mode reason
}

# ===========================================================================
# Subcommand: trivial
# ===========================================================================
compute_trivial() {
  : "${CLASSIFY_SOURCE_PATH:?CLASSIFY_SOURCE_PATH required (path to service worktree/repo)}"
  : "${CLASSIFY_SERVICES_IN_PHASE:?CLASSIFY_SERVICES_IN_PHASE required (integer)}"

  if [[ ! -d "$CLASSIFY_SOURCE_PATH" ]]; then
    echo "ERROR: source path not found: $CLASSIFY_SOURCE_PATH" >&2
    exit 1
  fi

  cd "$CLASSIFY_SOURCE_PATH"

  # Diff stats.
  STAT_OUTPUT="$(git diff --shortstat HEAD 2>/dev/null || echo "")"
  FILES_CHANGED="$(echo "$STAT_OUTPUT" | grep -oE '[0-9]+ files? changed' | grep -oE '[0-9]+' || echo 0)"
  INSERTIONS="$(echo "$STAT_OUTPUT" | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo 0)"
  DELETIONS="$(echo "$STAT_OUTPUT" | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo 0)"
  LINES_CHANGED=$((INSERTIONS + DELETIONS))

  DIFF_FILES="$(git diff --name-only HEAD 2>/dev/null || echo "")"

  HAS_LOCKFILE="false"
  HAS_MIGRATION="false"
  HAS_DTS="false"
  HAS_TSCONFIG="false"
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    case "$file" in
      package-lock.json|yarn.lock|pnpm-lock.yaml|composer.lock|poetry.lock|Cargo.lock|go.sum)
        HAS_LOCKFILE="true" ;;
      package.json) HAS_LOCKFILE="true" ;;
      *migrations/*) HAS_MIGRATION="true" ;;
      *.d.ts) HAS_DTS="true" ;;
      tsconfig*.json) HAS_TSCONFIG="true" ;;
    esac
  done <<< "$DIFF_FILES"

  TRIVIAL="false"
  TRIVIAL_REASON=""
  DOWNGRADE=""

  if [[ "$FRONTMATTER_TRIVIAL" == "1" ]]; then
    # Frontmatter override: trivial unless safety bounds exceeded.
    if [[ "$LINES_CHANGED" -gt 50 ]] || [[ "$HAS_LOCKFILE" == "true" ]] || [[ "$HAS_MIGRATION" == "true" ]] || [[ "$HAS_DTS" == "true" ]]; then
      TRIVIAL="false"
      TRIVIAL_REASON="frontmatter_override_downgraded"
      DOWNGRADE="$([[ "$LINES_CHANGED" -gt 50 ]] && echo "lines_over_50 " || true)$([[ "$HAS_LOCKFILE" == "true" ]] && echo "lockfile " || true)$([[ "$HAS_MIGRATION" == "true" ]] && echo "migration " || true)$([[ "$HAS_DTS" == "true" ]] && echo "dts" || true)"
      DOWNGRADE="$(echo "$DOWNGRADE" | xargs)"
    else
      TRIVIAL="true"
      TRIVIAL_REASON="frontmatter_override"
    fi
  else
    # Default classifier: ≤20 LOC AND ≤3 files AND no risky files AND single service.
    if [[ "$LINES_CHANGED" -le 20 ]] && [[ "$FILES_CHANGED" -le 3 ]] && \
       [[ "$HAS_LOCKFILE" == "false" ]] && [[ "$HAS_MIGRATION" == "false" ]] && \
       [[ "$HAS_DTS" == "false" ]] && [[ "$HAS_TSCONFIG" == "false" ]] && \
       [[ "$CLASSIFY_SERVICES_IN_PHASE" -eq 1 ]]; then
      TRIVIAL="true"
      TRIVIAL_REASON="size_gate"
    else
      TRIVIAL="false"
      TRIVIAL_REASON="size_gate"
    fi
  fi
}

emit_trivial() {
  local reason_key="$1"
  echo "trivial=$TRIVIAL"
  echo "lines_changed=$LINES_CHANGED"
  echo "files_changed=$FILES_CHANGED"
  echo "has_lockfile=$HAS_LOCKFILE"
  echo "has_migration=$HAS_MIGRATION"
  echo "has_dts=$HAS_DTS"
  echo "has_tsconfig=$HAS_TSCONFIG"
  echo "$reason_key=$TRIVIAL_REASON"
  if [[ -n "$DOWNGRADE" ]]; then
    echo "downgrade_reason=$DOWNGRADE"
  fi
}

classify_trivial() {
  FRONTMATTER_TRIVIAL="${CLASSIFY_FRONTMATTER_TRIVIAL:-0}"
  compute_trivial
  emit_trivial reason
}

classify_all() {
  compute_mode
  if [[ "$OVERRIDE" == "trivial" ]]; then
    FRONTMATTER_TRIVIAL="1"
  else
    FRONTMATTER_TRIVIAL="0"
  fi
  compute_trivial
  emit_mode mode_reason
  emit_trivial trivial_reason
}

# ===========================================================================
# Subcommand: compilable
# ===========================================================================
classify_compilable() {
  : "${CLASSIFY_FILES?CLASSIFY_FILES required (newline-separated file list)}"

  if [[ -z "$CLASSIFY_FILES" ]]; then
    # No files = nothing to compile.
    echo "compilable=false"
    echo "reason=no_files"
    exit 0
  fi

  COMPILABLE="false"
  FORCING_FILE=""
  EXTENSIONS_SEEN=()

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue

    # Forcing files: package.json and tsconfig*.json always trigger a build.
    case "$file" in
      package.json|tsconfig*.json)
        COMPILABLE="true"
        FORCING_FILE="$file"
        ;;
    esac
    if [[ "$COMPILABLE" == "true" ]] && [[ -n "$FORCING_FILE" ]]; then
      continue
    fi

    # Extract extension (everything after the last dot).
    ext="${file##*.}"
    if [[ "$ext" == "$file" ]] || [[ -z "$ext" ]]; then
      ext="(none)"
    fi

    # Track unique extensions for reporting.
    seen=false
    for s in "${EXTENSIONS_SEEN[@]:-}"; do
      if [[ "$s" == "$ext" ]]; then seen=true; break; fi
    done
    if [[ "$seen" == "false" ]]; then
      EXTENSIONS_SEEN+=("$ext")
    fi

    # If extension is NOT in the non-compilable list, it's compilable.
    is_non_compilable=false
    for nce in "${NON_COMPILABLE_EXTS[@]}"; do
      if [[ "$ext" == "$nce" ]]; then is_non_compilable=true; break; fi
    done

    if [[ "$is_non_compilable" == "false" ]]; then
      # Special case: .json files OTHER than package.json/tsconfig*.json
      # are configuration data, not compilable.
      if [[ "$ext" == "json" ]]; then
        continue
      fi
      COMPILABLE="true"
    fi
  done <<< "$CLASSIFY_FILES"

  echo "compilable=$COMPILABLE"
  if [[ -n "$FORCING_FILE" ]]; then
    echo "forcing_file=$FORCING_FILE"
  fi
  if [[ ${#EXTENSIONS_SEEN[@]} -gt 0 ]]; then
    IFS=','
    echo "extensions=${EXTENSIONS_SEEN[*]}"
    unset IFS
  fi
}

# ===========================================================================
# Dispatcher
# ===========================================================================
case "$SUBCOMMAND" in
  mode)        classify_mode ;;
  trivial)     classify_trivial ;;
  all)         classify_all ;;
  compilable)  classify_compilable ;;
  *)
    echo "ERROR: unknown subcommand: $SUBCOMMAND (expected mode|trivial|all|compilable)" >&2
    exit 1
    ;;
esac
