#!/usr/bin/env bash
set -euo pipefail

# jlu-update.sh — bring the installed plugin to the latest version for one host.
# Powers the /jlu-update command in every runtime.
#
# Codex and OpenCode have no built-in plugin updater, so this pulls the shared
# git cache ($JLU_HOME, created by install.sh) and re-runs setup for the host.
#
# Claude Code installs from the marketplace (no git cache); there it drives the
# non-interactive CLI — `claude plugin marketplace update` then `claude plugin
# update jlu@jelou-spec-plugin` — so /jlu-update applies the update directly
# instead of handing off to the interactive `/plugin update`. A restart is still
# required to load the new version. Set JLU_CLAUDE_CLI to override the binary.

REPO_URL="https://github.com/cristian-pisco/jelou-spec-plugin"
JLU_HOME="${JLU_HOME:-$HOME/.jelou-spec-plugin}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REF="main"
HOST=""
SOURCE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)
      [ "$#" -lt 2 ] && { echo "Error: --host requires a value" >&2; exit 2; }
      case "$2" in
        claude|opencode|codex) HOST="$2" ;;
        *) echo "Error: --host must be one of: claude, opencode, codex" >&2; exit 2 ;;
      esac
      shift 2
      ;;
    --source)
      [ "$#" -lt 2 ] && { echo "Error: --source requires a value" >&2; exit 2; }
      SOURCE="$2"; shift 2
      ;;
    --ref)
      [ "$#" -lt 2 ] && { echo "Error: --ref requires a value" >&2; exit 2; }
      REF="$2"; shift 2
      ;;
    -h|--help)
      echo "Usage: jlu-update.sh --host <claude|codex|opencode> [--source <dir>] [--ref <ref>]"
      exit 0
      ;;
    *)
      echo "Error: unknown option '$1'" >&2; exit 2
      ;;
  esac
done

[ -z "$HOST" ] && { echo "Error: --host is required (claude, codex, or opencode)" >&2; exit 2; }

is_git_repo() { [ -d "$1/.git" ]; }

read_version() {
  grep -o '"version": "[^"]*"' "$1/package.json" 2>/dev/null | head -1 | grep -o '[0-9]*\.[0-9]*\.[0-9]*' || true
}

require_dep() { command -v "$1" >/dev/null 2>&1 || { echo "Error: $1 is required but not found on PATH." >&2; exit 4; }; }

CACHE=""
if is_git_repo "$JLU_HOME"; then
  CACHE="$JLU_HOME"
elif [ -n "$SOURCE" ] && is_git_repo "$SOURCE"; then
  CACHE="$(cd "$SOURCE" && pwd)"
elif [ "$HOST" != "claude" ] && is_git_repo "$SCRIPT_ROOT"; then
  CACHE="$SCRIPT_ROOT"
fi

if [ -z "$CACHE" ] && [ "$HOST" != "claude" ]; then
  if [ "${JLU_UPDATE_DRYRUN:-0}" = "1" ]; then
    echo "REF: $REF"
    echo "CACHE: $JLU_HOME"
    echo "HOST: $HOST"
    echo "PLAN: clone $REPO_URL -> $JLU_HOME"
    echo "PLAN: setup --host $HOST"
    exit 0
  fi
  require_dep git
  if [ -e "$JLU_HOME" ]; then
    cat >&2 <<MSG
No local plugin git cache found, and $JLU_HOME already exists but is not a git checkout.
Move it aside or set JLU_HOME to an empty path, then run /jlu-update again.
MSG
    exit 3
  fi
  echo "No local plugin git cache found. Creating $JLU_HOME ..."
  mkdir -p "$(dirname "$JLU_HOME")"
  git clone --quiet "$REPO_URL" "$JLU_HOME"
  CACHE="$JLU_HOME"
fi

if [ -z "$CACHE" ]; then
  if [ "$HOST" = "claude" ]; then
    CLAUDE_BIN="${JLU_CLAUDE_CLI:-claude}"
    if command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
      if [ "${JLU_UPDATE_DRYRUN:-0}" = "1" ]; then
        echo "HOST: claude"
        echo "PLAN: $CLAUDE_BIN plugin update jlu@jelou-spec-plugin"
        exit 0
      fi
      echo "Updating via the Claude Code plugin CLI ..."
      "$CLAUDE_BIN" plugin marketplace update jelou-spec-plugin || true
      "$CLAUDE_BIN" plugin update jlu@jelou-spec-plugin
      echo
      echo "Restart Claude Code (or open a new session) to load the new version."
      exit 0
    fi
    cat >&2 <<MSG
No local plugin git cache found ($JLU_HOME) and the 'claude' CLI is not on PATH.
Update from inside Claude Code with:
  /plugin update jlu@jelou-spec-plugin
MSG
    exit 0
  fi
fi

if [ "${JLU_UPDATE_DRYRUN:-0}" = "1" ]; then
  echo "REF: $REF"
  echo "CACHE: $CACHE"
  echo "HOST: $HOST"
  echo "PLAN: setup --host $HOST"
  exit 0
fi

require_dep git

OLD_VERSION="$(read_version "$CACHE")"

echo "Updating cached plugin in $CACHE ($REF) ..."
git -C "$CACHE" fetch --tags --quiet origin
git -C "$CACHE" checkout --quiet "$REF"
git -C "$CACHE" pull --ff-only --quiet origin "$REF" 2>/dev/null || true

NEW_VERSION="$(read_version "$CACHE")"
if [ -n "$OLD_VERSION" ] && [ -n "$NEW_VERSION" ]; then
  if [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
    echo "Already at v$NEW_VERSION."
  else
    echo "Updated v$OLD_VERSION -> v$NEW_VERSION."
  fi
fi

echo "Reinstalling into: $HOST"
exec "$CACHE/setup" --host "$HOST"
