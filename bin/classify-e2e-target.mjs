#!/usr/bin/env node
// bin/classify-e2e-target.mjs — classify an E2E_BASE_URL as `safe` or `prod`.
//
// Default-deny: a target is `safe` only when its host is obviously non-production.
// Everything else — including apps.jelou.ai / workflows.jelou.ai — is `prod`.
// Invalid or empty input classifies as `prod` (fail-safe).
//
// Usage:
//   node bin/classify-e2e-target.mjs <url>   # prints "safe" or "prod"
//   node bin/classify-e2e-target.mjs --version
//
// Always exits 0 — callers branch on the printed string, not the exit code.

import { argv, stdout, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.0';

// Tokens that mark a host segment as a non-production environment.
const SAFE_TOKENS = ['staging', 'dev', 'sandbox', 'qa', 'test'];
// Match a token only on host-segment boundaries (start/end or '.'/'-'),
// so "latest" does NOT match "test" and "devops" does NOT match "dev".
const SAFE_TOKEN_RE = new RegExp(`(^|[.-])(${SAFE_TOKENS.join('|')})([.-]|$)`);

export function classifyTarget(raw) {
  if (!raw || typeof raw !== 'string') return 'prod';
  let host;
  try {
    host = new URL(raw).hostname;
  } catch {
    return 'prod';
  }
  if (!host) return 'prod';
  const h = host.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  // Known gap: IPv4-mapped loopback (e.g. ::ffff:127.0.0.1, normalized by the URL
  // parser to ::ffff:7f00:1) is NOT recognized and falls through to 'prod'. This is
  // a rare form in browser E2E (Playwright normalizes loopback to localhost/127.0.0.1),
  // and matching IPv4-mapped ranges broadly would risk false-allowing non-loopback addrs.
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return 'safe';
  if (h.endsWith('.local')) return 'safe';
  if (SAFE_TOKEN_RE.test(h)) return 'safe';
  return 'prod';
}

function main() {
  const arg = argv[2];
  if (arg === '--version') {
    stdout.write(`${VERSION}\n`);
    exit(0);
  }
  stdout.write(`${classifyTarget(arg)}\n`);
  exit(0);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
