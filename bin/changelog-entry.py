#!/usr/bin/env python3
"""Bump the patch version and prepend a CHANGELOG entry from a commit message.

Invoked by .githooks/commit-msg with the commit message file as argv[1].

Properties:
  - Atomic: reads all three manifest versions first; aborts (exit 1) if they
    differ, so a partial drift can never compound silently.
  - Idempotent: if any manifest already has a staged version change, the bump
    is skipped — re-running on the same commit attempt is a no-op.
  - Skips merges, rebases, cherry-picks, reverts, and amends so historical
    rewrites never touch the version.
  - Honors a "[skip-bump]" marker in the commit subject or body.

Exit codes:
  0  bumped, skipped intentionally, or no-op
  1  drift detected, message unparseable, or unexpected failure (aborts commit)
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

VERSION_RE = re.compile(r'"version"\s*:\s*"([^"]+)"')


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


def read_version(path: Path) -> str:
    m = VERSION_RE.search(path.read_text())
    if not m:
        raise RuntimeError(f"{path}: no version field")
    return m.group(1)


def write_version(path: Path, old: str, new: str) -> None:
    pattern = re.compile(r'("version"\s*:\s*")' + re.escape(old) + r'(")')
    content = path.read_text()
    updated, count = pattern.subn(rf"\g<1>{new}\g<2>", content, count=1)
    if count == 0:
        raise RuntimeError(f"{path}: version string {old!r} not found")
    path.write_text(updated)


def git_show(project: Path, ref: str) -> str | None:
    """Return file contents at a git ref, or None if the ref does not exist."""
    res = subprocess.run(
        ["git", "-C", str(project), "show", ref],
        capture_output=True, text=True,
    )
    return res.stdout if res.returncode == 0 else None


def staged_version_changed(project: Path, rel: str) -> bool:
    """True if the file's staged version differs from HEAD's version."""
    head = git_show(project, f"HEAD:{rel}")
    staged = git_show(project, f":{rel}")
    if head is None or staged is None:
        return False
    head_m = VERSION_RE.search(head)
    staged_m = VERSION_RE.search(staged)
    if not head_m or not staged_m:
        return False
    return head_m.group(1) != staged_m.group(1)


def in_special_state(project: Path) -> bool:
    """Skip merges, rebases, cherry-picks, reverts."""
    git_dir = subprocess.run(
        ["git", "-C", str(project), "rev-parse", "--git-dir"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    g = Path(git_dir)
    if not g.is_absolute():
        g = project / g
    for marker in ("MERGE_MSG", "CHERRY_PICK_HEAD", "REVERT_HEAD"):
        if (g / marker).exists():
            return True
    for d in ("rebase-merge", "rebase-apply"):
        if (g / d).exists():
            return True
    return False


def is_amend() -> bool:
    return "amend" in os.environ.get("GIT_REFLOG_ACTION", "").lower()


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


def parse_message(text: str) -> tuple[str, str]:
    """Strip git comment lines, return (subject, body)."""
    lines = [l for l in text.splitlines() if not l.startswith("#")]
    cleaned = "\n".join(lines).strip()
    if not cleaned:
        return "", ""
    parts = cleaned.split("\n", 1)
    subject = parts[0].strip()
    body = parts[1].strip() if len(parts) > 1 else ""
    return subject, body


def main() -> int:
    if len(sys.argv) < 2:
        print("changelog-entry: missing commit message file path", file=sys.stderr)
        return 1

    msg_path = Path(sys.argv[1])
    if not msg_path.exists():
        print(f"changelog-entry: message file not found: {msg_path}", file=sys.stderr)
        return 1

    project = Path(
        subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    )

    if in_special_state(project) or is_amend():
        return 0

    subject, body = parse_message(msg_path.read_text())
    if not subject:
        print("changelog-entry: empty commit subject — aborting.", file=sys.stderr)
        return 1

    if "[skip-bump]" in subject or "[skip-bump]" in body:
        return 0

    if any(staged_version_changed(project, rel) for rel in VERSION_FILES):
        return 0

    versions = {rel: read_version(project / rel) for rel in VERSION_FILES}
    distinct = set(versions.values())
    if len(distinct) > 1:
        detail = "\n".join(f"  {rel}: {v}" for rel, v in versions.items())
        print(
            "changelog-entry: version drift across manifest files — aborting commit.\n"
            f"{detail}\n"
            "Sync them manually so all three match, then re-commit.",
            file=sys.stderr,
        )
        return 1

    old = next(iter(distinct))
    new = bump_patch(old)

    try:
        for rel in VERSION_FILES:
            write_version(project / rel, old, new)
        prepend_changelog(project, build_entry(new, subject, body))
        stage(project, *VERSION_FILES, "CHANGELOG.md")
    except Exception as e:
        print(f"changelog-entry: {e}", file=sys.stderr)
        return 1

    print(f"changelog-entry: bumped {old} → {new}; CHANGELOG entry added.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
