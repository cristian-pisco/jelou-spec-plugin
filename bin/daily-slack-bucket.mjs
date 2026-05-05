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
import { isClosedLike, loadClosedLikeStatuses } from './lib/daily-slack-status.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--current') args.current = argv[++i];
    else if (argv[i] === '--snapshot') args.snapshot = argv[++i];
    else if (argv[i] === '--closed-like-statuses') args.closedLike = argv[++i];
  }
  if (!args.current) {
    console.error('error: --current <path> is required');
    process.exit(2);
  }
  return args;
}

function snapshotEntry(t) {
  return {
    name: t.name,
    url: t.url,
    percentage: t.percentage,
    status_type: t.status_type,
    status_name: t.status_name,
  };
}

function normalizePercentage(entry, closedLike) {
  return isClosedLike(entry, closedLike) ? 100 : entry.percentage;
}

function bucket(current, prior, closedLike) {
  const achieved = [];
  const not_achieved = [];
  const new_snapshot = {};
  for (const t of current) {
    if (!t.clickup_id) {
      console.error(`error: task missing clickup_id: ${JSON.stringify(t)}`);
      process.exit(2);
    }
    t.percentage = normalizePercentage(t, closedLike);
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
    const becameClosed = !isClosedLike(p, closedLike) && isClosedLike(t, closedLike);
    const advanced = t.percentage > p.percentage;
    if (becameClosed || advanced) achieved.push(t);
    else not_achieved.push(t);
  }
  return { achieved, not_achieved, new_snapshot, first_run: !prior };
}

function main() {
  const { current, snapshot, closedLike } = parseArgs(process.argv);
  const cur = parseJsonOrDie(readOrDie(current, '--current'), '--current');
  const closedLikeStatuses = loadClosedLikeStatuses(closedLike);
  let prior = null;
  if (snapshot && existsSync(snapshot)) {
    prior = parseJsonOrDie(readOrDie(snapshot, '--snapshot'), '--snapshot');
    for (const id of Object.keys(prior)) {
      prior[id].percentage = normalizePercentage(prior[id], closedLikeStatuses);
    }
  }
  process.stdout.write(JSON.stringify(bucket(cur, prior, closedLikeStatuses)) + '\n');
}

main();
