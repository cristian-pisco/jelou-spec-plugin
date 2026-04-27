// bin/lib/daily-slack-helpers.mjs
//
// Shared file-reading and JSON-parsing helpers for the daily-slack bin scripts.

import { readFileSync } from 'node:fs';

export function readOrDie(path, label) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    console.error(`error: cannot read ${label} file (${path}): ${e.message}`);
    process.exit(2);
  }
}

export function parseJsonOrDie(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`error: ${label} is not valid JSON: ${e.message}`);
    process.exit(2);
  }
}
