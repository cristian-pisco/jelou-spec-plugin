#!/usr/bin/env node
// bin/daily-slack-bucket.mjs
//
// Reads current task data and an optional prior snapshot, computes
// achieved/not-achieved buckets, and prints the result + new snapshot
// as JSON to stdout.
//
// Usage:
//   node bin/daily-slack-bucket.mjs --current <path> [--snapshot <path>]

import { existsSync } from 'node:fs';
import { readOrDie, parseJsonOrDie } from './lib/daily-slack-helpers.mjs';

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

function snapshotEntry(t) {
  return { name: t.name, url: t.url, percentage: t.percentage, status_type: t.status_type };
}

function normalizePercentage(entry) {
  return entry.status_type === 'closed' ? 100 : entry.percentage;
}

function bucket(current, prior) {
  const achieved = [];
  const not_achieved = [];
  const new_snapshot = {};
  for (const t of current) {
    if (!t.clickup_id) {
      console.error(`error: task missing clickup_id: ${JSON.stringify(t)}`);
      process.exit(2);
    }
    t.percentage = normalizePercentage(t);
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
  const cur = parseJsonOrDie(readOrDie(current, '--current'), '--current');
  let prior = null;
  if (snapshot && existsSync(snapshot)) {
    prior = parseJsonOrDie(readOrDie(snapshot, '--snapshot'), '--snapshot');
    for (const id of Object.keys(prior)) {
      prior[id].percentage = normalizePercentage(prior[id]);
    }
  }
  process.stdout.write(JSON.stringify(bucket(cur, prior)) + '\n');
}

main();
