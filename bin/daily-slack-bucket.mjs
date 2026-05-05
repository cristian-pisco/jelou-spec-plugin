#!/usr/bin/env node
// bin/daily-slack-bucket.mjs
//
// Reads current task data and an optional prior snapshot, computes
// achieved/not-achieved buckets, and prints the result + new snapshot
// as JSON to stdout.
//
// Usage:
//   node bin/daily-slack-bucket.mjs --current <path> [--snapshot <path>]
//     [--closed-like-statuses <path>] [--status-percentages <path>]
//     [--cutoff-ms <epoch-ms>]
//
// Bucketing rules (top to bottom; first match wins):
//   1. Task became closed-like since prior snapshot → achieved.
//   2. Task percentage advanced vs prior snapshot → achieved.
//   3. Task has `date_closed >= cutoff` (when --cutoff-ms is set) → achieved.
//   4. New task (no prior entry) at percentage > 0 → achieved.
//   5. Otherwise → not_achieved.
//
// Percentage normalization (applied before bucketing):
//   - Closed-like (status_type === 'closed' OR status_name ∈ closed-like list) → 100.
//   - status_name ∈ status_percentages map → mapped value (e.g. "pending to production" → 90).
//   - Else: the entry's existing percentage.

import { existsSync } from 'node:fs';
import { readOrDie, parseJsonOrDie } from './lib/daily-slack-helpers.mjs';
import {
  isClosedLike,
  loadClosedLikeStatuses,
  loadStatusPercentages,
  statusToPercentage,
} from './lib/daily-slack-status.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--current') args.current = argv[++i];
    else if (argv[i] === '--snapshot') args.snapshot = argv[++i];
    else if (argv[i] === '--closed-like-statuses') args.closedLike = argv[++i];
    else if (argv[i] === '--status-percentages') args.statusPercentages = argv[++i];
    else if (argv[i] === '--cutoff-ms') args.cutoffMs = argv[++i];
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

function normalizePercentage(entry, closedLike, statusPercentages) {
  return statusToPercentage(entry, closedLike, statusPercentages);
}

function bucket(current, prior, closedLike, statusPercentages, cutoffMs) {
  const achieved = [];
  const not_achieved = [];
  const new_snapshot = {};
  for (const t of current) {
    if (!t.clickup_id) {
      console.error(`error: task missing clickup_id: ${JSON.stringify(t)}`);
      process.exit(2);
    }
    t.percentage = normalizePercentage(t, closedLike, statusPercentages);
    new_snapshot[t.clickup_id] = snapshotEntry(t);
    const p = prior ? prior[t.clickup_id] : undefined;
    const closedSinceCutoff =
      cutoffMs != null &&
      t.date_closed != null &&
      Number(t.date_closed) >= cutoffMs;
    if (!prior) {
      if (closedSinceCutoff) achieved.push(t);
      else not_achieved.push(t);
      continue;
    }
    if (p === undefined) {
      if (t.percentage > 0 || closedSinceCutoff) achieved.push(t);
      else not_achieved.push(t);
      continue;
    }
    const becameClosed = !isClosedLike(p, closedLike) && isClosedLike(t, closedLike);
    const advanced = t.percentage > p.percentage;
    if (becameClosed || advanced || closedSinceCutoff) achieved.push(t);
    else not_achieved.push(t);
  }
  return { achieved, not_achieved, new_snapshot, first_run: !prior };
}

function main() {
  const args = parseArgs(process.argv);
  const cur = parseJsonOrDie(readOrDie(args.current, '--current'), '--current');
  const closedLikeStatuses = loadClosedLikeStatuses(args.closedLike);
  const statusPercentages = loadStatusPercentages(args.statusPercentages);
  const cutoffMs = args.cutoffMs == null ? null : Number(args.cutoffMs);
  if (cutoffMs != null && !Number.isFinite(cutoffMs)) {
    console.error('error: --cutoff-ms must be a number (epoch milliseconds)');
    process.exit(2);
  }
  let prior = null;
  if (args.snapshot && existsSync(args.snapshot)) {
    prior = parseJsonOrDie(readOrDie(args.snapshot, '--snapshot'), '--snapshot');
    for (const id of Object.keys(prior)) {
      prior[id].percentage = normalizePercentage(prior[id], closedLikeStatuses, statusPercentages);
    }
  }
  process.stdout.write(
    JSON.stringify(bucket(cur, prior, closedLikeStatuses, statusPercentages, cutoffMs)) + '\n'
  );
}

main();
