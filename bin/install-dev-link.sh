#!/usr/bin/env bash
set -euo pipefail

MARKER_BEGIN="# >>> jelou-spec-plugin dev-link >>>"
MARKER_END="# <<< jelou-spec-plugin dev-link <<<"

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="install"
FORCED_RC=""

usage() {
  cat <<'USAGE'
Usage: bin/install-dev-link.sh [options]

Adds jlu-dev and jlu-dev-c to your shell startup file so every terminal can load
this working tree as the live plugin, with no plugin install involved.

  jlu-dev     start a session with this tree loaded (any directory)
  jlu-dev-c   the same, resuming the last conversation

Options:
  --detect          print the startup file that would be written, then exit
  --print           print the shell block, without writing anything
  --uninstall       remove a previously written block
  --rc <path>       write to this startup file instead of the detected one
  -h, --help        show this help

Environment:
  JLU_UNAME_S       override the detected OS (defaults to `uname -s`)
  SHELL             selects zsh vs bash when both are plausible
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --detect) MODE="detect" ;;
    --print) MODE="print" ;;
    --uninstall) MODE="uninstall" ;;
    --rc) shift; FORCED_RC="${1:-}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option '$1'" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

resolve_rc() {
  if [ -n "$FORCED_RC" ]; then
    printf '%s\n' "$FORCED_RC"
    return 0
  fi

  local os shell_name
  os="${JLU_UNAME_S:-$(uname -s)}"
  shell_name="$(basename "${SHELL:-bash}")"

  case "$os" in
    Linux)
      case "$shell_name" in
        zsh) printf '%s\n' "$HOME/.zshrc" ;;
        *) printf '%s\n' "$HOME/.bashrc" ;;
      esac
      ;;
    Darwin)
      case "$shell_name" in
        bash) printf '%s\n' "$HOME/.bash_profile" ;;
        *) printf '%s\n' "$HOME/.zshrc" ;;
      esac
      ;;
    *)
      echo "unsupported OS '$os' — pass --rc <path> to choose a startup file" >&2
      return 1
      ;;
  esac
}

shell_block() {
  printf '%s\n' "$MARKER_BEGIN"
  printf 'jlu-dev() { claude --plugin-dir "%s" "$@"; }\n' "$PLUGIN_DIR"
  printf 'jlu-dev-c() { jlu-dev --continue "$@"; }\n'
  printf '%s\n' "$MARKER_END"
}

strip_block() {
  local file="$1"
  [ -f "$file" ] || return 0
  awk -v b="$MARKER_BEGIN" -v e="$MARKER_END" '
    $0 == b { pending = 0; skip = 1; next }
    skip == 1 { if ($0 == e) skip = 0; next }
    /^[[:space:]]*$/ { pending++; next }
    { while (pending-- > 0) print ""; pending = 0; print }
    END { while (pending-- > 0) print "" }
  ' "$file"
}

has_block() {
  [ -f "$1" ] && grep -qF "$MARKER_BEGIN" "$1"
}

RC="$(resolve_rc)"

case "$MODE" in
  detect)
    printf '%s\n' "$RC"
    exit 0
    ;;
  print)
    shell_block
    exit 0
    ;;
esac

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if [ "$MODE" = "uninstall" ]; then
  if ! has_block "$RC"; then
    echo "nothing to remove — no dev-link block in $RC"
    exit 0
  fi
  cp "$RC" "$RC.jlu-dev-link.bak"
  strip_block "$RC" > "$tmp"
  cat "$tmp" > "$RC"
  echo "removed the dev-link block from $RC (backup: $RC.jlu-dev-link.bak)"
  echo "open a new terminal, or run: source $RC"
  exit 0
fi

if [ -f "$RC" ]; then
  cp "$RC" "$RC.jlu-dev-link.bak"
  strip_block "$RC" > "$tmp"
else
  : > "$tmp"
fi

if grep -qE '^[[:space:]]*(jlu-dev|jlu-dev-c)[[:space:]]*\(\)' "$tmp" ||
   grep -qE '^[[:space:]]*alias[[:space:]]+(jlu-dev|jlu-dev-c)=' "$tmp"; then
  echo "warning: $RC already defines jlu-dev or jlu-dev-c outside this script's block." >&2
  echo "         Delete the hand-written definition, or the last one to load wins." >&2
fi

if [ -s "$tmp" ] && [ -n "$(tail -c 1 "$tmp")" ]; then
  printf '\n' >> "$tmp"
fi
if [ -s "$tmp" ]; then
  printf '\n' >> "$tmp"
fi
shell_block >> "$tmp"
cat "$tmp" > "$RC"

if has_block "$RC"; then
  echo "wrote jlu-dev and jlu-dev-c to $RC"
  echo "  plugin dir: $PLUGIN_DIR"
  echo "open a new terminal, or run: source $RC"
else
  echo "failed to write the dev-link block to $RC" >&2
  exit 1
fi
