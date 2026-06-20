#!/usr/bin/env bash
set -euo pipefail

# Jelou Spec Plugin — remote bootstrap installer.
# Usage: curl -fsSL <raw-url>/install.sh | bash [-s -- <options>]

REPO_URL="https://github.com/cristian-pisco/jelou-spec-plugin.git"
JLU_HOME="${JLU_HOME:-$HOME/.jelou-spec-plugin}"
REF="main"
declare -a HOSTS=()
declare -a PASSTHROUGH=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      [ "$#" -lt 2 ] && { echo "Error: --host requires a value" >&2; exit 2; }
      case "$2" in
        claude|opencode|codex) HOSTS+=("$2") ;;
        *) echo "Error: --host must be one of: claude, opencode, codex" >&2; exit 2 ;;
      esac
      shift 2
      ;;
    --ref)
      [ "$#" -lt 2 ] && { echo "Error: --ref requires a value" >&2; exit 2; }
      REF="$2"; shift 2
      ;;
    --project|--opencode-target|--codex-target)
      [ "$#" -lt 2 ] && { echo "Error: $1 requires a value" >&2; exit 2; }
      PASSTHROUGH+=("$1" "$2"); shift 2
      ;;
    --no-opencode-global|--no-codex-global)
      PASSTHROUGH+=("$1"); shift
      ;;
    -h|--help)
      echo "Usage: curl -fsSL <raw-url>/install.sh | bash -s -- [--host claude|opencode|codex] [--ref <ref>]"
      exit 0
      ;;
    *)
      echo "Error: unknown option '$1'" >&2; exit 2
      ;;
  esac
done

emit_plan() {
  echo "REF: $REF"
  echo "CACHE: $JLU_HOME"
  local line="PLAN: setup"
  local h p
  for h in ${HOSTS[@]+"${HOSTS[@]}"}; do line="$line --host $h"; done
  for p in ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}; do line="$line $p"; done
  echo "$line"
}

detect_hosts() {
  if [ -n "${JLU_DETECT_OVERRIDE+x}" ]; then
    # shellcheck disable=SC2206
    local injected=( ${JLU_DETECT_OVERRIDE} )
    [ "${#injected[@]}" -gt 0 ] && printf '%s\n' "${injected[@]}"
    return 0
  fi
  { command -v claude   >/dev/null 2>&1 || [ -d "$HOME/.claude" ]; }                       && echo claude
  { command -v codex    >/dev/null 2>&1 || [ -d "${CODEX_HOME:-$HOME/.codex}" ]; }          && echo codex
  { command -v opencode >/dev/null 2>&1 || [ -d "${OPENCODE_HOME:-$HOME/.config/opencode}" ]; } && echo opencode
  return 0
}

if [ "${#HOSTS[@]}" -eq 0 ]; then
  while IFS= read -r _h; do
    [ -n "$_h" ] && HOSTS+=("$_h")
  done < <(detect_hosts)
fi

if [ "${#HOSTS[@]}" -eq 0 ]; then
  echo "Error: no supported CLI detected (claude, codex, opencode). Pass --host explicitly." >&2
  exit 3
fi

if [ "${JLU_BOOTSTRAP_DRYRUN:-0}" = "1" ]; then
  emit_plan
  exit 0
fi
