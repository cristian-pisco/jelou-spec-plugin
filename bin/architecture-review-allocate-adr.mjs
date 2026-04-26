#!/usr/bin/env node
// bin/architecture-review-allocate-adr.mjs
//
// Scans <decisions-dir> for files matching ADR-NNNN-*.md, parses the leading
// 4-digit number, prints max+1 zero-padded to stdout. On a missing or empty
// directory, prints 0001.
//
// Usage:
//   node bin/architecture-review-allocate-adr.mjs --decisions-dir <abs-path>

import { existsSync, readdirSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--decisions-dir') {
      args.decisionsDir = argv[++i];
    }
  }
  if (!args.decisionsDir) {
    console.error('error: --decisions-dir <path> is required');
    process.exit(2);
  }
  return args;
}

const ADR_RE = /^ADR-(\d{4})-[a-z0-9-]+\.md$/;

function main() {
  const { decisionsDir } = parseArgs(process.argv);
  let max = 0;
  if (existsSync(decisionsDir)) {
    for (const name of readdirSync(decisionsDir)) {
      const m = ADR_RE.exec(name);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
  }
  const next = (max + 1).toString().padStart(4, '0');
  process.stdout.write(next + '\n');
}

main();
