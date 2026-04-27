#!/usr/bin/env node
// bin/daily-slack-render.mjs
//
// Renders the three automated placeholders for the daily Slack report from
// a JSON input file. Outputs {achieved_goals, not_achieved_goals,
// short_term_goals} as JSON on stdout.
//
// Usage:
//   node bin/daily-slack-render.mjs --data <path>

import { readOrDie, parseJsonOrDie } from './lib/daily-slack-helpers.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--data') args.data = argv[++i];
  }
  if (!args.data) {
    console.error('error: --data <path> is required');
    process.exit(2);
  }
  return args;
}

const FIRST_RUN_BANNER = '_Primer reporte del sprint — sin línea base para comparar._';
const ACHIEVED_EMPTY = '_Sin avances desde la última actualización._';
const NOT_ACHIEVED_EMPTY = '_Todas las tareas avanzaron._';

function renderAchieved(achieved, firstRun) {
  if (firstRun) return FIRST_RUN_BANNER;
  if (!achieved.length) return ACHIEVED_EMPTY;
  return achieved.map((t) => `[${t.percentage}%] ${t.name}\n${t.url}`).join('\n\n');
}

function renderNotAchieved(not_achieved) {
  if (!not_achieved.length) return NOT_ACHIEVED_EMPTY;
  return not_achieved.map((t) => `${t.name} — ${t.reason}\n${t.url}`).join('\n\n');
}

function isoDate(s) {
  return s.slice(0, 10);
}

function renderShortTerm(short_term) {
  const withDates = short_term.filter((t) => t.due_date);
  withDates.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
  return withDates.map((t) => `[${isoDate(t.due_date)}] ${t.name} ${t.url}`).join('\n');
}

function main() {
  const { data } = parseArgs(process.argv);
  const d = parseJsonOrDie(readOrDie(data, '--data'), '--data');
  const out = {
    achieved_goals: renderAchieved(d.achieved || [], !!d.first_run),
    not_achieved_goals: renderNotAchieved(d.not_achieved || []),
    short_term_goals: renderShortTerm(d.short_term || []),
  };
  process.stdout.write(JSON.stringify(out) + '\n');
}

main();
