#!/usr/bin/env node
// bin/boot-dev-server.mjs — launch a dev server with env loaded from .env files via a
// robust parser, never bash `source`. Replaces the old
// `set -a; . ./.env; . ./.env.e2e; set +a; <dev.command>` in env-lifecycle.md boot()
// for npm/make/shell launchers.
//
// Usage:
//   node boot-dev-server.mjs --worktree <dir> [--env-files a,b] --cmd '<shell command>'
//
// Loads each env file (later overrides earlier), merges over the current environment, and
// runs the command in <dir> with that environment via `sh -lc`, inheriting stdio. The
// command's exit code (or terminating signal) is propagated. Values are never printed —
// which is the whole point: a real `.env` with an unquoted value breaks `bash source` and
// trips the guard-env-reads hook, leaving a frontend dev server to bake the app's `.env`
// (e.g. a prod API base URL) and ignore the `.env.e2e` overlay.

import process from 'node:process';
import { spawn } from 'node:child_process';
import { mergedEnv } from './lib/env-files.mjs';

function parseArgs(argv) {
  const o = { worktree: null, envFiles: ['.env', '.env.e2e'], cmd: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--worktree') o.worktree = argv[++i];
    else if (a === '--env-files') o.envFiles = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--cmd') o.cmd = argv[++i];
    else { console.error(`boot-dev-server: unexpected arg '${a}'`); process.exit(2); }
  }
  return o;
}

const { worktree, envFiles, cmd } = parseArgs(process.argv.slice(2));
if (!worktree || !cmd) {
  console.error("boot-dev-server: usage: --worktree <dir> [--env-files a,b] --cmd '<command>'");
  process.exit(2);
}

const env = mergedEnv(worktree, envFiles);
const child = spawn('sh', ['-lc', cmd], { cwd: worktree, env, stdio: 'inherit' });
child.on('error', (e) => {
  console.error(`boot-dev-server: ${e.message}`);
  process.exit(127);
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
