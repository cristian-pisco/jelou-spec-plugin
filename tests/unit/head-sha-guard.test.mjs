import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardHeadSha, parseArgs, EXIT_CODES } from '../../bin/head-sha-guard.mjs';

const GUARD_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'head-sha-guard.mjs');

function fakeRunner(responses) {
  const calls = [];
  return {
    calls,
    runner(cmd, args) {
      calls.push([cmd, ...args]);
      const key = `${cmd} ${args.join(' ')}`;
      const match = responses.find((r) => key.startsWith(r.prefix));
      return match ? match.result : { status: 1, stdout: '', stderr: `no stub for: ${key}` };
    },
  };
}

function makeFakeGitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'head-sha-guard-'));
  const script = [
    '#!/bin/sh',
    'if [ "$1" = "fetch" ]; then exit "${FAKE_GIT_FETCH_STATUS:-0}"; fi',
    'if [ "$1" = "rev-parse" ]; then',
    '  if [ -n "${FAKE_GIT_REVPARSE_FAIL:-}" ]; then echo "unknown revision" >&2; exit 128; fi',
    '  echo "${FAKE_GIT_SHA:-abc123}"; exit 0',
    'fi',
    'exit 1',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'git'), script);
  chmodSync(join(dir, 'git'), 0o755);
  return dir;
}

function runCli({ gitDir, vars = {}, entryPath = GUARD_PATH }) {
  return spawnSync(
    process.execPath,
    [entryPath, '--remote', 'origin', '--branch', 'main', '--expected', 'abc123'],
    { encoding: 'utf8', env: { ...process.env, PATH: `${gitDir}:${process.env.PATH}`, ...vars } },
  );
}

describe('head-sha-guard library', () => {
  test('ok when remote head matches expected', () => {
    const { runner, calls } = fakeRunner([
      { prefix: 'git fetch', result: { status: 0, stdout: '', stderr: '' } },
      { prefix: 'git rev-parse', result: { status: 0, stdout: 'abc123\n', stderr: '' } },
    ]);
    const result = guardHeadSha({ remote: 'origin', branch: 'production/x', expected: 'abc123', runner });
    assert.equal(result.status, 'ok');
    assert.equal(result.remoteSha, 'abc123');
    assert.deepEqual(calls[0], ['git', 'fetch', 'origin', 'production/x']);
    assert.deepEqual(calls[1], ['git', 'rev-parse', 'origin/production/x']);
  });

  test('moved when the branch advanced externally', () => {
    const { runner } = fakeRunner([
      { prefix: 'git fetch', result: { status: 0, stdout: '', stderr: '' } },
      { prefix: 'git rev-parse', result: { status: 0, stdout: 'def456\n', stderr: '' } },
    ]);
    const result = guardHeadSha({ remote: 'origin', branch: 'main', expected: 'abc123', runner });
    assert.equal(result.status, 'moved');
    assert.equal(result.remoteSha, 'def456');
    assert.equal(result.expected, 'abc123');
  });

  test('error when fetch fails', () => {
    const { runner } = fakeRunner([
      { prefix: 'git fetch', result: { status: 128, stdout: '', stderr: 'could not read from remote' } },
    ]);
    const result = guardHeadSha({ remote: 'origin', branch: 'main', expected: 'abc123', runner });
    assert.equal(result.status, 'error');
    assert.match(result.message, /could not read from remote/);
  });

  test('error when rev-parse fails', () => {
    const { runner } = fakeRunner([
      { prefix: 'git fetch', result: { status: 0, stdout: '', stderr: '' } },
      { prefix: 'git rev-parse', result: { status: 128, stdout: '', stderr: 'unknown revision' } },
    ]);
    const result = guardHeadSha({ remote: 'origin', branch: 'main', expected: 'abc123', runner });
    assert.equal(result.status, 'error');
  });

  test('error when required args are missing', () => {
    const result = guardHeadSha({ remote: 'origin', branch: '', expected: 'abc123' });
    assert.equal(result.status, 'error');
  });
});

describe('head-sha-guard argument parsing', () => {
  test('parseArgs extracts the three flags', () => {
    const args = parseArgs(['--remote', 'origin', '--branch', 'main', '--expected', 'abc123']);
    assert.deepEqual(args, { remote: 'origin', branch: 'main', expected: 'abc123' });
  });

  test('flag without a value yields undefined and guard rejects it', () => {
    const args = parseArgs(['--remote']);
    assert.equal(args.remote, undefined);
    assert.equal(guardHeadSha(args).status, 'error');
  });

  test('unknown flags are ignored', () => {
    const args = parseArgs(['--force', '--remote', 'origin', '--branch', 'main', '--expected', 'x']);
    assert.deepEqual(args, { remote: 'origin', branch: 'main', expected: 'x' });
  });

  test('repeated flags last-write-win', () => {
    const args = parseArgs(['--branch', 'a', '--branch', 'b']);
    assert.equal(args.branch, 'b');
  });
});

describe('head-sha-guard CLI contract', () => {
  test('EXIT_CODES map is the documented contract', () => {
    assert.deepEqual(EXIT_CODES, { ok: 0, error: 2, moved: 3 });
  });

  test('exit 0 with ok JSON when remote matches', () => {
    const gitDir = makeFakeGitDir();
    const r = runCli({ gitDir, vars: { FAKE_GIT_SHA: 'abc123' } });
    assert.equal(r.status, EXIT_CODES.ok);
    assert.equal(JSON.parse(r.stdout).status, 'ok');
  });

  test('exit 3 with moved JSON when remote differs', () => {
    const gitDir = makeFakeGitDir();
    const r = runCli({ gitDir, vars: { FAKE_GIT_SHA: 'def456' } });
    assert.equal(r.status, EXIT_CODES.moved);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'moved');
    assert.equal(out.remoteSha, 'def456');
  });

  test('exit 2 with error JSON carrying the message on stdout when fetch fails', () => {
    const gitDir = makeFakeGitDir();
    const r = runCli({ gitDir, vars: { FAKE_GIT_FETCH_STATUS: '128' } });
    assert.equal(r.status, EXIT_CODES.error);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'error');
    assert.ok(out.message.length > 0);
  });

  test('main still runs when invoked through a symlinked path', () => {
    const gitDir = makeFakeGitDir();
    const linkPath = join(gitDir, 'guard-link.mjs');
    symlinkSync(GUARD_PATH, linkPath);
    const r = runCli({ gitDir, vars: { FAKE_GIT_SHA: 'def456' }, entryPath: linkPath });
    assert.equal(r.status, EXIT_CODES.moved);
    assert.equal(JSON.parse(r.stdout).status, 'moved');
  });
});
