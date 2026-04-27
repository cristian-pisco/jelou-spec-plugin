#!/usr/bin/env node
// bin/daily-slack-bucket.mjs
//
// Reads current task data and an optional prior snapshot, computes
// achieved/not-achieved buckets, and prints the result + new snapshot
// as JSON to stdout.
//
// Usage:
//   node bin/daily-slack-bucket.mjs --current <path> [--snapshot <path>]

import { existsSync, readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--current') args.current = argv[++i];
    else if (argv[i] === '--snapshot') args.snapshot = argv[++i];
  }
  if (!args.current) {
    console.error('error: --current <path> is required');
    process.exit(2);
  }
  return args;
}

function readOrDie(path, label) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`error: could not read ${label} file "${path}": ${err.message}`);
    process.exit(2);
  }
}

function snapshotEntry(t) {
  return { name: t.name, url: t.url, percentage: t.percentage, status_type: t.status_type };
}

function bucket(current, prior) {
  const achieved = [];
  const not_achieved = [];
  const new_snapshot = {};
  for (const t of current) {
    new_snapshot[t.clickup_id] = snapshotEntry(t);
    const p = prior ? prior[t.clickup_id] : undefined;
    if (!prior) {
      not_achieved.push(t);
      continue;
    }
    if (p === undefined) {
      if (t.percentage > 0) achieved.push(t);
      else not_achieved.push(t);
      continue;
    }
    const becameClosed = p.status_type !== 'closed' && t.status_type === 'closed';
    const advanced = t.percentage > p.percentage;
    if (becameClosed || advanced) achieved.push(t);
    else not_achieved.push(t);
  }
  return { achieved, not_achieved, new_snapshot, first_run: !prior };
}

function main() {
  const { current, snapshot } = parseArgs(process.argv);
  const cur = JSON.parse(readOrDie(current, '--current'));
  let prior = null;
  if (snapshot && existsSync(snapshot)) {
    prior = JSON.parse(readOrDie(snapshot, '--snapshot'));
  }
  process.stdout.write(JSON.stringify(bucket(cur, prior)) + '\n');
}

main();
