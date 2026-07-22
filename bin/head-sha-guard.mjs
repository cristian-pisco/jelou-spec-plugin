#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function defaultRunner(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

export function guardHeadSha({ remote, branch, expected, runner = defaultRunner }) {
  if (!remote || !branch || !expected) {
    return { status: 'error', message: 'remote, branch, and expected are required' };
  }
  const fetch = runner('git', ['fetch', remote, branch]);
  if (fetch.status !== 0) {
    return { status: 'error', message: `git fetch failed: ${(fetch.stderr || '').trim()}` };
  }
  const revParse = runner('git', ['rev-parse', `${remote}/${branch}`]);
  if (revParse.status !== 0) {
    return { status: 'error', message: `git rev-parse failed: ${(revParse.stderr || '').trim()}` };
  }
  const remoteSha = (revParse.stdout || '').trim();
  if (remoteSha === expected) {
    return { status: 'ok', remoteSha };
  }
  return { status: 'moved', remoteSha, expected };
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--remote') out.remote = argv[++i];
    else if (argv[i] === '--branch') out.branch = argv[++i];
    else if (argv[i] === '--expected') out.expected = argv[++i];
  }
  return out;
}

export const EXIT_CODES = { ok: 0, error: 2, moved: 3 };

function main() {
  const result = guardHeadSha(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(EXIT_CODES[result.status]);
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main();
}
