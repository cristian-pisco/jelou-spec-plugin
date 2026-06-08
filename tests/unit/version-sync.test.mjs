// tests/unit/version-sync.test.mjs
//
// Guards against the silent-drift scenario fixed in 0.3.162: package.json
// would bump while the manifests stayed frozen, and the marketplace kept
// shipping the stale version. Catches drift in CI even on a clone where
// the commit-msg hook has not been installed.
//
// Run: `node --test tests/unit/version-sync.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const VERSION_FILES = [
  'package.json',
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.codex-plugin/plugin.json',
];

const VERSION_RE = /"version"\s*:\s*"([^"]+)"/;

function readVersion(relPath) {
  const content = readFileSync(resolve(PROJECT_ROOT, relPath), 'utf8');
  const match = content.match(VERSION_RE);
  if (!match) throw new Error(`${relPath}: no "version" field`);
  return match[1];
}

describe('version sync across manifest files', () => {
  test('all manifest version files declare the same version', () => {
    const versions = Object.fromEntries(
      VERSION_FILES.map((f) => [f, readVersion(f)])
    );
    const distinct = new Set(Object.values(versions));
    assert.equal(
      distinct.size,
      1,
      `Manifest versions are desynced — the marketplace installs from ` +
        `.claude-plugin/marketplace.json on origin/main, so any drift here ` +
        `silently ships a stale version. Bring all three to the same value:\n` +
        Object.entries(versions)
          .map(([f, v]) => `  ${f}: ${v}`)
          .join('\n')
    );
  });

  test('every version follows semver patch format (X.Y.Z)', () => {
    for (const file of VERSION_FILES) {
      const version = readVersion(file);
      assert.match(
        version,
        /^\d+\.\d+\.\d+$/,
        `${file} has non-semver version ${version}`
      );
    }
  });
});
