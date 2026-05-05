// bin/lib/daily-slack-status.mjs
//
// Shared logic for treating ClickUp statuses as "closed" beyond just the
// status_type === 'closed' invariant. ClickUp custom statuses such as
// "pending to production" or "in review" carry status_type === 'custom'
// in the API response, but teams typically consider them done. The
// channel template can declare those statuses in `closed_like_statuses`
// (frontmatter, case-insensitive list) and the daily-slack scripts use
// this helper to honor the declaration uniformly.

import { existsSync } from 'node:fs';
import { readOrDie, parseJsonOrDie } from './daily-slack-helpers.mjs';

export function loadClosedLikeStatuses(path) {
  if (!path) return [];
  if (!existsSync(path)) {
    console.error(`error: --closed-like-statuses file not found: ${path}`);
    process.exit(2);
  }
  const arr = parseJsonOrDie(readOrDie(path, '--closed-like-statuses'), '--closed-like-statuses');
  if (!Array.isArray(arr)) {
    console.error('error: --closed-like-statuses must be a JSON array of status name strings');
    process.exit(2);
  }
  return arr.map((s) => String(s).toLowerCase());
}

export function isClosedLike(entry, closedLikeStatusesLower) {
  if (!entry) return false;
  if (entry.status_type === 'closed') return true;
  if (!closedLikeStatusesLower || closedLikeStatusesLower.length === 0) return false;
  const name = entry.status_name == null ? '' : String(entry.status_name).toLowerCase();
  if (!name) return false;
  return closedLikeStatusesLower.includes(name);
}

// Reads an optional JSON map of `{ "<status name lowercased>": <percentage 0-100>, ... }`
// from disk. The map lets channel templates teach the bucketer that, e.g.,
// "pending to production" is effectively 90% and "in qa" is 80% — independent
// of the task's subtask ratio. Returns an empty object when no path is given.
export function loadStatusPercentages(path) {
  if (!path) return {};
  if (!existsSync(path)) {
    console.error(`error: --status-percentages file not found: ${path}`);
    process.exit(2);
  }
  const obj = parseJsonOrDie(readOrDie(path, '--status-percentages'), '--status-percentages');
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
    console.error('error: --status-percentages must be a JSON object mapping status name → percentage');
    process.exit(2);
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'number' || v < 0 || v > 100) {
      console.error(`error: --status-percentages value for "${k}" must be a number 0-100`);
      process.exit(2);
    }
    out[String(k).toLowerCase()] = Math.round(v);
  }
  return out;
}

// Returns the percentage to use for a task given its status_name and the
// `status_percentages` map. Closed-like takes precedence (always 100). Then
// the explicit map. Falls back to the entry's existing percentage.
export function statusToPercentage(entry, closedLikeStatusesLower, statusPercentagesMap) {
  if (isClosedLike(entry, closedLikeStatusesLower)) return 100;
  if (!entry || !statusPercentagesMap) return entry?.percentage ?? 0;
  const name = entry.status_name == null ? '' : String(entry.status_name).toLowerCase();
  if (!name) return entry.percentage ?? 0;
  if (Object.prototype.hasOwnProperty.call(statusPercentagesMap, name)) {
    return statusPercentagesMap[name];
  }
  return entry.percentage ?? 0;
}
