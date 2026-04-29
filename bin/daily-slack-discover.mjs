#!/usr/bin/env node
// bin/daily-slack-discover.mjs
//
// Filters a raw ClickUp sprint-list dump (concatenation of `get_tasks` pages)
// for tasks the user owns: `assignees` contains user_id OR the `Responsable`
// custom field references user_id. Excludes IDs already covered by plugin
// tasks. Prints the clickup-only stubs as JSON to stdout.
//
// Usage:
//   node bin/daily-slack-discover.mjs \
//     --tasks <path>                # array of ClickUp task objects (raw shape)
//     --user-id <id>                # ClickUp user id (string or number)
//     --responsable-field-id <uuid> # custom-field UUID for "Responsable"
//     --plugin-ids <path>           # JSON array of plugin task IDs to skip
//
// Output (stdout): JSON array of
//   { clickup_id, name, url, source: "clickup-only", slug: null, pr_urls: [] }

import { readOrDie, parseJsonOrDie } from './lib/daily-slack-helpers.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--tasks') args.tasks = argv[++i];
    else if (argv[i] === '--user-id') args.userId = argv[++i];
    else if (argv[i] === '--responsable-field-id') args.responsableFieldId = argv[++i];
    else if (argv[i] === '--plugin-ids') args.pluginIds = argv[++i];
  }
  const missing = [];
  if (!args.tasks) missing.push('--tasks');
  if (!args.userId) missing.push('--user-id');
  if (!args.responsableFieldId) missing.push('--responsable-field-id');
  if (!args.pluginIds) missing.push('--plugin-ids');
  if (missing.length) {
    console.error(`error: required arg(s) missing: ${missing.join(', ')}`);
    process.exit(2);
  }
  return args;
}

function sameId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function isAssignee(task, userId) {
  const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
  return assignees.some((a) => sameId(a?.id ?? a, userId));
}

// The "Responsable" custom field in ClickUp is a `users` type; its `value`
// is documented as an array — but the ClickUp API has shipped a few shapes
// over time. Handle the realistic ones: array of user objects, array of
// raw IDs, single user object, single ID, or a stringified JSON of any of
// the above.
function fieldReferencesUser(field, userId) {
  if (!field) return false;
  let value = field.value;
  if (value == null) return false;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return sameId(value, userId);
    }
  }
  const candidates = Array.isArray(value) ? value : [value];
  return candidates.some((c) => sameId(c?.id ?? c, userId));
}

function isResponsable(task, userId, fieldId) {
  const fields = Array.isArray(task?.custom_fields) ? task.custom_fields : [];
  const field = fields.find((f) => sameId(f?.id, fieldId));
  return fieldReferencesUser(field, userId);
}

function ownsTask(task, userId, responsableFieldId) {
  return isAssignee(task, userId) || isResponsable(task, userId, responsableFieldId);
}

function toStub(task) {
  return {
    clickup_id: task.id,
    name: task.name,
    url: task.url,
    source: 'clickup-only',
    slug: null,
    pr_urls: [],
  };
}

function discover(tasks, pluginIds, userId, responsableFieldId) {
  const skip = new Set(pluginIds.map(String));
  const seen = new Set();
  const out = [];
  for (const t of tasks) {
    if (!t || !t.id) continue;
    const id = String(t.id);
    if (skip.has(id) || seen.has(id)) continue;
    if (!ownsTask(t, userId, responsableFieldId)) continue;
    seen.add(id);
    out.push(toStub(t));
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const rawTasks = parseJsonOrDie(readOrDie(args.tasks, '--tasks'), '--tasks');
  const pluginIds = parseJsonOrDie(readOrDie(args.pluginIds, '--plugin-ids'), '--plugin-ids');
  if (!Array.isArray(rawTasks)) {
    console.error('error: --tasks must contain a JSON array');
    process.exit(2);
  }
  if (!Array.isArray(pluginIds)) {
    console.error('error: --plugin-ids must contain a JSON array');
    process.exit(2);
  }
  const result = discover(rawTasks, pluginIds, args.userId, args.responsableFieldId);
  process.stdout.write(JSON.stringify(result) + '\n');
}

main();
