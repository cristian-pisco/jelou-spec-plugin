#!/usr/bin/env python3
"""Single-release version bumper and CHANGELOG entry writer.

Usage:
    python3 bin/changelog-entry.py --release -m "<subject>" [--body "<text>"] \
        [--minor|--major] [--project-dir <dir>] [--no-stage]

Behavior:
  - Reads all 4 manifest versions; exits 1 if they differ (drift guard).
  - Computes next version: patch by default, minor with --minor, major with --major.
  - Writes the new version to all 4 manifests and prepends one CHANGELOG entry.
  - Stages the 4 manifests + CHANGELOG.md unless --no-stage is passed.
  - Prints "released <old> → <new>" and exits 0.
  - Requires -m; exits 1 if missing.

Exit codes:
  0  release written (or --no-stage dry run)
  1  drift detected, missing -m, or unexpected failure
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

VERSION_FILES = (
    "package.json",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ".codex-plugin/plugin.json",
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


def parse_semver(version: str) -> tuple[int, int, int]:
    major, minor, patch = (int(p) for p in version.split("."))
    return major, minor, patch


def expected_next(parent: str, marker: str | None) -> str:
    """Return the version that follows `parent` for the given bump type."""
    maj, mn, pt = parse_semver(parent)
    if marker == "bump-major":
        return f"{maj + 1}.0.0"
    if marker == "bump-minor":
        return f"{maj}.{mn + 1}.0"
    return f"{maj}.{mn}.{pt + 1}"


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
    parser = argparse.ArgumentParser(
        description="Bump plugin version and write a CHANGELOG entry.",
    )
    parser.add_argument("--release", action="store_true", required=True,
                        help="Run in release mode (required).")
    parser.add_argument("-m", dest="subject", metavar="SUBJECT",
                        help="Release subject line (required).")
    parser.add_argument("--body", default="",
                        help="Optional body text with '- bullet' lines.")
    bump_group = parser.add_mutually_exclusive_group()
    bump_group.add_argument("--minor", action="store_true",
                            help="Bump the minor version (x.Y.0).")
    bump_group.add_argument("--major", action="store_true",
                            help="Bump the major version (X.0.0).")
    parser.add_argument("--project-dir", default=None,
                        help="Project root (default: git rev-parse --show-toplevel).")
    parser.add_argument("--no-stage", action="store_true",
                        help="Skip the git add step (useful for tests).")

    args = parser.parse_args()

    if not args.subject:
        print("changelog-entry: -m <subject> is required.", file=sys.stderr)
        return 1

    if args.project_dir:
        project = Path(args.project_dir).resolve()
    else:
        project = Path(
            subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                capture_output=True, text=True, check=True,
            ).stdout.strip()
        )

    versions = {}
    for rel in VERSION_FILES:
        try:
            versions[rel] = read_version(project / rel)
        except Exception as e:
            print(f"changelog-entry: {e}", file=sys.stderr)
            return 1

    distinct = set(versions.values())
    if len(distinct) > 1:
        detail = "\n".join(f"  {rel}: {v}" for rel, v in versions.items())
        print(
            "changelog-entry: version drift across manifest files — aborting.\n"
            f"{detail}\n"
            "Sync them manually so all four match, then re-run.",
            file=sys.stderr,
        )
        return 1

    old = next(iter(distinct))
    marker = "bump-major" if args.major else ("bump-minor" if args.minor else None)

    try:
        new = expected_next(old, marker)
    except ValueError:
        print(f"changelog-entry: invalid semver in manifest ({old}).", file=sys.stderr)
        return 1

    try:
        for rel in VERSION_FILES:
            write_version(project / rel, old, new)
        prepend_changelog(project, build_entry(new, args.subject, args.body))
        if not args.no_stage:
            stage(project, *VERSION_FILES, "CHANGELOG.md")
    except Exception as e:
        print(f"changelog-entry: {e}", file=sys.stderr)
        return 1

    print(f"released {old} → {new}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
