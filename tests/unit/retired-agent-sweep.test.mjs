import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const NEEDLE = 'qa-' + 'agent';
const SELF = 'tests/unit/retired-agent-sweep.test.mjs';

const LEGACY_FILE_ALLOWLIST = new Set([
  'bin/lib/trace/failure.mjs',
  'jelou/references/tracing.md',
  'tests/unit/trace-failure.test.mjs',
  'tests/unit/trace-scorecard.test.mjs',
  'tests/unit/trace-rules.test.mjs',
  SELF,
]);

const LEGACY_DIR_ALLOWLIST = ['tests/fixtures/trace/'];

const isLegacy = (rel) =>
  LEGACY_FILE_ALLOWLIST.has(rel) || LEGACY_DIR_ALLOWLIST.some((dir) => rel.startsWith(dir));

const repoFiles = () => {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
    .split('\n')
    .filter(Boolean);
  return [...new Set(listed)].filter(
    (rel) => !rel.split('/').includes('node_modules') && basename(rel) !== 'CHANGELOG.md',
  );
};

const readOrEmpty = (rel) => {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    return '';
  }
};

describe('retired agent sweep — permanent anti-reintroduction gate', () => {
  const files = repoFiles();

  test('the repo file listing is non-empty', () => {
    assert.ok(files.length > 100, 'git ls-files returned suspiciously few files');
  });

  test('content sweep hits only the closed legacy allowlist', () => {
    const offenders = files.filter((rel) => !isLegacy(rel) && readOrEmpty(rel).includes(NEEDLE));
    assert.deepEqual(
      offenders,
      [],
      `retired agent "${NEEDLE}" referenced outside the closed legacy allowlist — remove the reference or justify a new legacy entry`,
    );
  });

  test('filename sweep finds zero files named after the retired agent', () => {
    const named = files.filter((rel) => basename(rel).includes(NEEDLE));
    assert.deepEqual(
      named,
      [],
      `a file named after the retired agent exists — the agent must stay deleted in every runtime mirror`,
    );
  });
});
