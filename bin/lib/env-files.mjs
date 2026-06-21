// bin/lib/env-files.mjs — dependency-free .env parsing + safe env injection.
//
// The boot/auth path used to inject env by bash-sourcing the files
// (`set -a; . ./.env; . ./.env.e2e; set +a`). That breaks two ways on a real-world
// `.env`: bash tries to EXECUTE fragments of unquoted values (a line like
// `KEY=foo bar&baz` aborts the source), and the `guard-env-reads` hook blocks the
// source outright to keep those fragments out of the transcript. A line-based parser
// reads the same files without ever handing a value to a shell — so a malformed-for-bash
// `.env` (which `dotenv` itself parses fine) no longer prevents the `.env.e2e` overlay
// from reaching the dev server / the bin tools.

import { readFileSync, existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

// Parse dotenv-style text. Takes everything after the first `=` as the raw value, so
// unquoted shell-special characters are harmless. Strips a single layer of matching
// surrounding quotes; only double-quoted values get `\n`/`\r`/`\t` unescaped. No shell
// expansion, no inline-comment stripping of unquoted values (keeps URLs/keys verbatim).
export function parseEnv(text) {
  const out = {};
  for (let line of String(text).split(/\r?\n/)) {
    line = line.replace(/^\s+/, '');
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).replace(/^\s+/, '');
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let val = line.slice(eq + 1);
    const q = val[0];
    if (val.length >= 2 && (q === '"' || q === "'") && val[val.length - 1] === q) {
      val = val.slice(1, -1);
      if (q === '"') val = val.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
    } else {
      val = val.replace(/\s+$/, '');
    }
    out[key] = val;
  }
  return out;
}

// Merge env files in order (later files override earlier ones).
export function loadEnvFiles(worktree, files = ['.env', '.env.e2e']) {
  const merged = {};
  for (const f of files) {
    const p = isAbsolute(f) ? f : resolve(worktree, f);
    if (!existsSync(p)) continue;
    try {
      Object.assign(merged, parseEnv(readFileSync(p, 'utf8')));
    } catch {
      // an unreadable file is skipped, never fatal — the overlay is best-effort
    }
  }
  return merged;
}

// Apply parsed values onto a target env object (e.g. process.env). File values WIN for
// keys the files define — matching the `set -a; . ./.env; . ./.env.e2e` semantics they
// replace. Keys absent from the files (UI_WORKTREE, OTP_FILE, PATH, …) are left untouched.
export function applyEnvFiles(target, worktree, files = ['.env', '.env.e2e']) {
  const parsed = loadEnvFiles(worktree, files);
  for (const [k, v] of Object.entries(parsed)) target[k] = v;
  return parsed;
}

// A child environment = the current process env with the file overlay applied on top.
export function mergedEnv(worktree, files = ['.env', '.env.e2e']) {
  return { ...process.env, ...loadEnvFiles(worktree, files) };
}
