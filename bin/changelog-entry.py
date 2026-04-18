#!/usr/bin/env python3
"""Bump version files and prepend an entry to CHANGELOG.md from a commit message.

Invoked by the pre-commit hook with the raw `git commit ...` command piped on
stdin. Extracts the commit message, bumps the patch version in the three
manifest files, prepends a categorized entry to CHANGELOG.md, and stages all
four files so they land in the same commit.

Exit codes:
  0  success (or the command was not a real `git commit` and was skipped)
  2  commit message could not be parsed — blocks the commit
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

VERSION_FILES = (
    "package.json",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
)


def extract_commit_message(command: str) -> str | None:
    # HEREDOC inside -m "$(cat <<'TAG' ... TAG)"
    m = re.search(r"<<'([A-Za-z_][A-Za-z0-9_]*)'\s*\n(.*?)\n\s*\1\b", command, re.DOTALL)
    if m:
        return m.group(2).strip()
    # HEREDOC without quotes: <<TAG
    m = re.search(r"<<([A-Za-z_][A-Za-z0-9_]*)\s*\n(.*?)\n\s*\1\b", command, re.DOTALL)
    if m:
        return m.group(2).strip()
    # -m "message" (handles escaped quotes)
    m = re.search(r'-m\s+"((?:[^"\\]|\\.)*)"', command)
    if m:
        return m.group(1).replace('\\"', '"').strip()
    # -m 'message'
    m = re.search(r"-m\s+'([^']*)'", command)
    if m:
        return m.group(1).strip()
    return None


def categorize(subject: str) -> str:
    low = subject.lower()
    if re.match(r"^(fix|bug)(\([^)]*\))?[:\s]", low):
        return "Fixed"
    if re.match(r"^(feat|add)(\([^)]*\))?[:\s]", low):
        return "Added"
    if re.match(r"^(remove|delete|deprecate)(\([^)]*\))?[:\s]", low):
        return "Removed"
    if re.match(r"^(docs|chore|refactor|internal|style|test|ci|build|perf)(\([^)]*\))?[:\s]", low):
        return "Internal"
    return "Changed"


def strip_conventional_prefix(subject: str) -> str:
    return re.sub(r"^[a-z]+(\([^)]*\))?:\s*", "", subject)


def bullets_from_body(body: str) -> list[str]:
    items: list[str] = []
    current: str | None = None
    for raw in body.splitlines():
        line = raw.rstrip()
        stripped = line.lstrip()
        is_bullet = stripped.startswith(("- ", "* "))
        if is_bullet:
            if current is not None:
                items.append(current)
            current = stripped[2:].strip()
        elif current is not None and line.startswith((" ", "\t")) and stripped:
            current += " " + stripped
        elif not stripped and current is not None:
            items.append(current)
            current = None
    if current is not None:
        items.append(current)
    return items


def bump_patch(version: str) -> str:
    major, minor, patch = version.split(".")
    return f"{major}.{minor}.{int(patch) + 1}"


def read_current_version(project: Path) -> str:
    text = (project / "package.json").read_text()
    m = re.search(r'"version":\s*"([^"]+)"', text)
    if not m:
        raise RuntimeError("no version field in package.json")
    return m.group(1)


def write_version(project: Path, old: str, new: str) -> None:
    pattern = re.compile(r'("version"\s*:\s*")' + re.escape(old) + r'(")')
    for rel in VERSION_FILES:
        path = project / rel
        content = path.read_text()
        updated, count = pattern.subn(rf'\g<1>{new}\g<2>', content, count=1)
        if count == 0:
            raise RuntimeError(f"{rel}: version string {old!r} not found")
        path.write_text(updated)


def build_entry(version: str, subject: str, body: str) -> str:
    category = categorize(subject)
    clean_subject = strip_conventional_prefix(subject)
    body_bullets = bullets_from_body(body)
    items = body_bullets if body_bullets else [clean_subject]

    lines = [
        f"## [{version}] — {date.today().isoformat()}",
        "",
        f"### {category}",
    ]
    lines.extend(f"- {it}" for it in items)
    lines.append("")
    return "\n".join(lines) + "\n"


def prepend_changelog(project: Path, entry: str) -> None:
    path = project / "CHANGELOG.md"
    content = path.read_text() if path.exists() else "# Changelog\n\n"
    header_match = re.match(r"(# Changelog\s*\n+)", content)
    if header_match:
        new_content = header_match.group(1) + entry + content[header_match.end():]
    else:
        new_content = "# Changelog\n\n" + entry + content
    path.write_text(new_content)


def stage(project: Path, *relpaths: str) -> None:
    subprocess.run(
        ["git", "-C", str(project), "add", *relpaths],
        check=True,
    )


def main() -> int:
    project = Path(os.environ.get("PROJECT_DIR") or os.getcwd()).resolve()
    command = sys.stdin.read()

    msg = extract_commit_message(command)
    if not msg:
        print(
            "pre-commit hook: could not parse commit message. Use `git commit -m \"...\"` "
            "or `git commit -m \"$(cat <<'EOF'\\n...\\nEOF\\n)\"`. Aborting so CHANGELOG "
            "and version do not drift apart.",
            file=sys.stderr,
        )
        return 2

    lines = msg.splitlines()
    subject = lines[0].strip() if lines else ""
    body = "\n".join(lines[1:]).strip()
    if not subject:
        print("pre-commit hook: empty commit subject — aborting.", file=sys.stderr)
        return 2

    old = read_current_version(project)
    new = bump_patch(old)
    write_version(project, old, new)

    entry = build_entry(new, subject, body)
    prepend_changelog(project, entry)

    stage(project, *VERSION_FILES, "CHANGELOG.md")
    print(f"Version bumped: {old} → {new}; CHANGELOG entry added.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
