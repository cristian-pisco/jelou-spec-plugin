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

if [ "${JLU_BOOTSTRAP_DRYRUN:-0}" = "1" ]; then
  emit_plan
  exit 0
fi
