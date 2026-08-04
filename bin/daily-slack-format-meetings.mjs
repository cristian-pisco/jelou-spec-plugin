#!/usr/bin/env node

import { readOrDie, parseJsonOrDie } from './lib/daily-slack-helpers.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--events') args.events = argv[++i];
  }
  if (!args.events) {
    console.error('error: --events <path> is required');
    process.exit(2);
  }
  return args;
}

function extractEvents(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.events)) return payload.events;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

function startKey(event) {
  const start = event.start || {};
  return new Date(start.dateTime || start.date || 0).getTime() || 0;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localTime(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatLine(event) {
  const summary = String(event.summary || '').trim() || '(sin título)';
  const start = event.start || {};
  const end = event.end || {};
  if (!start.dateTime) return summary;
  const from = localTime(start.dateTime);
  return end.dateTime ? `${summary} (${from}–${localTime(end.dateTime)})` : `${summary} (${from})`;
}

function main() {
  const { events: eventsPath } = parseArgs(process.argv);
  const payload = parseJsonOrDie(readOrDie(eventsPath, '--events'), '--events');
  const lines = extractEvents(payload)
    .map((event) => ({ event, key: startKey(event) }))
    .sort((a, b) => a.key - b.key)
    .map(({ event }) => formatLine(event));
  process.stdout.write(lines.length ? lines.join('\n') + '\n' : '');
}

main();
