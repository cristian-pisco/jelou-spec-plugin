import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SELF = 'tests/unit/retired-agent-sweep.test.mjs';

const TRACE_HISTORY_ALLOWLIST = [
  'bin/lib/trace/failure.mjs',
  'jelou/references/tracing.md',
  'tests/unit/trace-failure.test.mjs',
  'tests/unit/trace-scorecard.test.mjs',
  'tests/unit/trace-rules.test.mjs',
  SELF,
];

const RETIRED_AGENTS = [
  {
    needle: 'qa-' + 'agent',
    fileAllowlist: new Set(TRACE_HISTORY_ALLOWLIST),
    dirAllowlist: ['tests/fixtures/trace/'],
  },
  {
    needle: 'spec-' + 'reviewer',
    fileAllowlist: new Set([
      'bin/lib/trace/failure.mjs',
      'jelou/references/tracing.md',
      'tests/unit/trace-failure.test.mjs',
      SELF,
      'jelou/references/parallel-dispatch.md',
      'jelou/references/qa-smell-catalog.md',
      'jelou/references/tdd-cycle.md',
      'jelou/references/tdd-principles.md',
      'jelou/workflows/execute-task.md',
      'jelou/workflows/ship.md',
      'tests/unit/autochain.test.mjs',
      'tests/unit/e2e-testcontainers-carveout.test.mjs',
      'tests/unit/no-comments-rule.test.mjs',
      'tests/unit/resource-caps.test.mjs',
      'tests/unit/spec-case-taxonomy.test.mjs',
      'tests/unit/doctrine-consolidation.test.mjs',
    ]),
    dirAllowlist: ['tests/fixtures/trace/'],
  },
];

const repoFiles = () => {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
    .split('\n')
    .filter(Boolean);
  return [...new Set(listed)].filter(
    (rel) =>
      !rel.split('/').includes('node_modules') &&
      basename(rel) !== 'CHANGELOG.md' &&
      existsSync(join(ROOT, rel)),
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

  for (const { needle, fileAllowlist, dirAllowlist } of RETIRED_AGENTS) {
    const isAllowed = (rel) =>
      fileAllowlist.has(rel) || dirAllowlist.some((dir) => rel.startsWith(dir));

    test(`"${needle}" content sweep hits only its closed allowlist`, () => {
      const offenders = files.filter((rel) => !isAllowed(rel) && readOrEmpty(rel).includes(needle));
      assert.deepEqual(
        offenders,
        [],
        `retired agent "${needle}" referenced outside the closed allowlist — remove the reference or justify a new entry`,
      );
    });

    test(`"${needle}" filename sweep finds zero files named after it`, () => {
      const named = files.filter((rel) => basename(rel).includes(needle));
      assert.deepEqual(
        named,
        [],
        `a file named after the retired agent "${needle}" exists — it must stay deleted in every runtime mirror`,
      );
    });

    test(`every "${needle}" allowlist entry still earns its place`, () => {
      const stale = [...fileAllowlist].filter(
        (rel) => rel !== SELF && !readOrEmpty(rel).includes(needle),
      );
      assert.deepEqual(
        stale,
        [],
        `allowlist entries no longer mention "${needle}" — drop them so the allowlist stays closed`,
      );
    });
  }
});
