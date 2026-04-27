#!/usr/bin/env node
// bin/daily-slack-extract-reason.mjs
//
// Reads a task JSON file and prints the priority-resolved "why" reason.
//
// Usage:
//   node bin/daily-slack-extract-reason.mjs --task <path>

import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--task') args.task = argv[++i];
  }
  if (!args.task) {
    console.error('error: --task <path> is required');
    process.exit(2);
  }
  return args;
}

function readOrDie(path, label) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    console.error(`error: cannot read ${label} file (${path}): ${e.message}`);
    process.exit(2);
  }
}

function parseJsonOrDie(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`error: ${label} is not valid JSON: ${e.message}`);
    process.exit(2);
  }
}

const FALLBACK = 'sin actualizaciones recientes — agregar razón manual';

function truncate(s) {
  return s.length > 200 ? s.slice(0, 200) : s;
}

function postCutoffComment(comments, cutoff) {
  if (!cutoff) return null;
  const after = comments
    .filter((c) => c.date_iso > cutoff)
    .sort((a, b) => (a.date_iso < b.date_iso ? 1 : -1));
  return after.length ? truncate(after[0].text) : null;
}

function prStateReason(pr_states) {
  const values = Object.values(pr_states || {});
  if (values.some((p) => p.isDraft)) return 'aún en borrador';
  if (values.some((p) => p.mergeable === false)) return 'con conflictos de merge';
  if (values.some((p) => p.state === 'OPEN' && p.checks === 'failing')) return 'CI fallando';
  if (values.some((p) => p.state === 'OPEN')) return 'esperando revisión';
  return null;
}

function mostRecentComment(comments) {
  if (!comments || comments.length === 0) return null;
  const sorted = [...comments].sort((a, b) => (a.date_iso < b.date_iso ? 1 : -1));
  return truncate(sorted[0].text);
}

function main() {
  const { task } = parseArgs(process.argv);
  const t = parseJsonOrDie(readOrDie(task, '--task'), '--task');
  const reason =
    postCutoffComment(t.comments || [], t.cutoff) ||
    prStateReason(t.pr_states) ||
    mostRecentComment(t.comments || []) ||
    FALLBACK;
  process.stdout.write(reason + '\n');
}

main();
