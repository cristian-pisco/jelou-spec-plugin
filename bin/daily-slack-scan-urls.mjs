#!/usr/bin/env node
// bin/daily-slack-scan-urls.mjs
//
// Scans a body file for app.clickup.com URLs and verifies every match is
// present in the allowlist file (one URL per line). Exits 0 on success;
// exits 1 and prints the first unknown URL to stderr on failure.
//
// Usage:
//   node bin/daily-slack-scan-urls.mjs --body <path> --allowlist <path>

import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--body') args.body = argv[++i];
    else if (argv[i] === '--allowlist') args.allowlist = argv[++i];
  }
  if (!args.body || !args.allowlist) {
    console.error('error: --body <path> and --allowlist <path> are required');
    process.exit(2);
  }
  return args;
}

const URL_RE = /https?:\/\/app\.clickup\.com\/t\/[^\s)]+/g;

function normalize(url) {
  return url.replace(/[.,);\]}]+$/, '').replace(/\?.*$/, '');
}

function main() {
  const { body, allowlist } = parseArgs(process.argv);
  const text = readFileSync(body, 'utf8');
  const allowed = new Set(
    readFileSync(allowlist, 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalize)
  );
  const matches = text.match(URL_RE) || [];
  for (const raw of matches) {
    const url = normalize(raw);
    if (!allowed.has(url)) {
      console.error(`unknown clickup url: ${url}`);
      process.exit(1);
    }
  }
  process.exit(0);
}

main();
