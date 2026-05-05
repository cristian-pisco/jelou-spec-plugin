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
