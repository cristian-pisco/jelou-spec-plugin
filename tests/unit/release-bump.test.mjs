// tests/unit/release-bump.test.mjs
//
// Tests for the `bin/changelog-entry.py --release` CLI.
// Each test case spins up an isolated temp dir with 4 manifests + a
// minimal CHANGELOG.md so the tool never touches the real project tree.
//
// Run: `node --test tests/unit/release-bump.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = resolve(PROJECT_ROOT, 'bin', 'changelog-entry.py');

const MANIFEST_FILES = [
  'package.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.codex-plugin/plugin.json',
];

function makeFixture(version = '0.3.100') {
  const dir = mkdtempSync(join(tmpdir(), 'release-bump-'));
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  mkdirSync(join(dir, '.codex-plugin'), { recursive: true });

  const manifests = {
    'package.json': `{\n  "name": "test",\n  "version": "${version}"\n}\n`,
    '.claude-plugin/plugin.json': `{\n  "version": "${version}"\n}\n`,
    '.claude-plugin/marketplace.json': `{\n  "version": "${version}"\n}\n`,
    '.codex-plugin/plugin.json': `{\n  "version": "${version}"\n}\n`,
  };

  for (const [rel, content] of Object.entries(manifests)) {
    writeFileSync(join(dir, rel), content, 'utf8');
  }

  writeFileSync(
    join(dir, 'CHANGELOG.md'),
    '# Changelog\n\nExisting content.\n',
    'utf8'
  );

  return dir;
}

function readVersion(dir, rel) {
  const text = readFileSync(join(dir, rel), 'utf8');
  const m = text.match(/"version"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error(`${rel}: no version field`);
  return m[1];
}

function runRelease(dir, extraArgs = []) {
  return spawnSync(
    'python3',
    [SCRIPT, '--release', '--project-dir', dir, '--no-stage', ...extraArgs],
    { encoding: 'utf8' }
  );
}

describe('release-bump CLI', () => {
  test('patch bump by default: 0.3.100 → 0.3.101 across all 4 manifests', () => {
    const dir = makeFixture('0.3.100');
    const result = runRelease(dir, ['-m', 'fix: correct thing']);

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    for (const rel of MANIFEST_FILES) {
      assert.equal(readVersion(dir, rel), '0.3.101', `${rel} not bumped`);
    }
  });

  test('--minor bumps: 0.3.100 → 0.4.0', () => {
    const dir = makeFixture('0.3.100');
    const result = runRelease(dir, ['-m', 'feat: new capability', '--minor']);

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    for (const rel of MANIFEST_FILES) {
      assert.equal(readVersion(dir, rel), '0.4.0', `${rel} not minor-bumped`);
    }
  });

  test('--major bumps: 0.3.100 → 1.0.0', () => {
    const dir = makeFixture('0.3.100');
    const result = runRelease(dir, ['-m', 'feat!: breaking change', '--major']);

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    for (const rel of MANIFEST_FILES) {
      assert.equal(readVersion(dir, rel), '1.0.0', `${rel} not major-bumped`);
    }
  });

  test('prepends exactly one new CHANGELOG entry', () => {
    const dir = makeFixture('0.3.100');
    const result = runRelease(dir, ['-m', 'feat: shiny thing']);

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    const entries = [...changelog.matchAll(/^## \[/gm)];
    assert.equal(entries.length, 1, 'expected exactly one ## [...] entry');
    assert.match(changelog, /## \[0\.3\.101\]/);
  });

  test('feat: prefix → Added category in CHANGELOG', () => {
    const dir = makeFixture('0.3.100');
    runRelease(dir, ['-m', 'feat: shiny thing']);

    const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /### Added/);
  });

  test('fix: prefix → Fixed category in CHANGELOG', () => {
    const dir = makeFixture('0.3.100');
    runRelease(dir, ['-m', 'fix: broken thing']);

    const changelog = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /### Fixed/);
  });

  test('drift (manifests not equal) → exit 1 and nothing written', () => {
    const dir = makeFixture('0.3.100');
    writeFileSync(
      join(dir, '.codex-plugin/plugin.json'),
      '{\n  "version": "0.3.99"\n}\n',
      'utf8'
    );

    const result = runRelease(dir, ['-m', 'feat: thing']);

    assert.notEqual(result.status, 0, 'expected non-zero exit on drift');
    assert.equal(readVersion(dir, 'package.json'), '0.3.100', 'package.json must not change');
  });

  test('missing -m → exit 1', () => {
    const dir = makeFixture('0.3.100');
    const result = runRelease(dir);

    assert.notEqual(result.status, 0, 'expected non-zero exit when -m is omitted');
  });
});
