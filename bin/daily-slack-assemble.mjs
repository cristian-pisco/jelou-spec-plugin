#!/usr/bin/env node
// bin/daily-slack-assemble.mjs
//
// Assembles `current-tasks.json` from a ClickUp sprint list deterministically,
// replacing the ad-hoc inline node scripting the orchestrator used to write at
// runtime (which is where status-shape bugs and env-var failures crept in).
//
// Two data sources, by design:
//   --list      the light `clickup_filter_tasks` page dump — already carries
//               id, name, url, status (string), assignees, due_date, date_closed.
//   --hydrated  the SUBSET of tasks fetched via `clickup_get_task(include:
//               custom_fields)` — needed only to read the `Responsable` field
//               (ownership) and `Tipo Proyecto` (task_type). Non-assignee tasks
//               must be hydrated; assignee-owned tasks may be omitted to cut the
//               number of heavy per-task fetches.
//
// A task is owned when the user is an assignee (known from --list, no hydration
// needed) OR the Responsable custom field references the user (needs --hydrated).
// Assignee-owned tasks absent from --hydrated keep light-list data and resolve
// task_type to null and percentage from the status invariants below.
//
// Percentage precedence: closed-like → 100, status_percentages map → mapped,
// subtask ratio → closed/total, else 0. The bucketer re-normalizes downstream;
// this is the in-progress fallback.
//
// Output (stdout): JSON array of
//   { clickup_id, name, url, percentage, status_type, status_name, task_type,
//     due_date, date_closed, date_updated, source, slug, pr_urls }

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readOrDie, parseJsonOrDie } from './lib/daily-slack-helpers.mjs';
import {
  loadClosedLikeStatuses,
  loadStatusPercentages,
  isClosedLike,
  statusToPercentage,
} from './lib/daily-slack-status.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--list') args.list = argv[++i];
    else if (argv[i] === '--hydrated') args.hydrated = argv[++i];
    else if (argv[i] === '--hydrated-dir') args.hydratedDir = argv[++i];
    else if (argv[i] === '--user-id') args.userId = argv[++i];
    else if (argv[i] === '--responsable-field-id') args.responsableFieldId = argv[++i];
    else if (argv[i] === '--tipo-field-id') args.tipoFieldId = argv[++i];
    else if (argv[i] === '--plugin-tasks') args.pluginTasks = argv[++i];
    else if (argv[i] === '--closed-like-statuses') args.closedLike = argv[++i];
    else if (argv[i] === '--status-percentages') args.statusPercentages = argv[++i];
  }
  const missing = [];
  if (!args.list) missing.push('--list');
  if (!args.userId) missing.push('--user-id');
  if (!args.responsableFieldId) missing.push('--responsable-field-id');
  if (missing.length) {
    console.error(`error: required arg(s) missing: ${missing.join(', ')}`);
    process.exit(2);
  }
  return args;
}

function loadArrayOrDie(path, label) {
  const arr = parseJsonOrDie(readOrDie(path, label), label);
  if (!Array.isArray(arr)) {
    console.error(`error: ${label} must contain a JSON array`);
    process.exit(2);
  }
  return arr;
}

function loadOptionalArray(path, label) {
  if (!path) return [];
  if (!existsSync(path)) {
    console.error(`error: ${label} file not found: ${path}`);
    process.exit(2);
  }
  return loadArrayOrDie(path, label);
}

// Gathers hydrated `clickup_get_task(include: custom_fields)` payloads that the
// harness dumped to individual files because each exceeds the MCP token limit.
// Selects only files that parse to a task object (top-level `id` + a
// `custom_fields` array), so unrelated dumps (filter_tasks pages, error blobs)
// are skipped. Returned newest-mtime-first so the dedup in assemble keeps the
// most recent payload per task id.
function gatherHydratedDir(dir) {
  if (!existsSync(dir)) {
    console.error(`error: --hydrated-dir not found: ${dir}`);
    process.exit(2);
  }
  const files = readdirSync(dir)
    .map((f) => join(dir, f))
    .map((p) => {
      try {
        return statSync(p).isFile() ? { p, m: statSync(p).mtimeMs } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.m - a.m);
  const out = [];
  for (const { p } of files) {
    let j;
    try {
      j = JSON.parse(readFileSync(p, 'utf8'));
    } catch {
      continue;
    }
    if (j && j.id != null && Array.isArray(j.custom_fields)) out.push(j);
  }
  return out;
}

function sameId(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function isAssignee(task, userId) {
  const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
  return assignees.some((a) => sameId(a?.id ?? a, userId));
}

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

function customField(task, fieldId) {
  const fields = Array.isArray(task?.custom_fields) ? task.custom_fields : [];
  return fields.find((f) => sameId(f?.id, fieldId));
}

function isResponsable(hydrated, userId, fieldId) {
  if (!hydrated) return false;
  return fieldReferencesUser(customField(hydrated, fieldId), userId);
}

const CLOSED_NAMES = new Set(['closed', 'complete', 'completed', 'done']);
const OPEN_NAMES = new Set(['open', 'to do', 'to-do', 'todo', 'backlog']);

function deriveStatusType(name) {
  const n = name == null ? '' : String(name).toLowerCase();
  if (CLOSED_NAMES.has(n)) return 'closed';
  if (OPEN_NAMES.has(n)) return 'open';
  return 'custom';
}

function normalizeStatus(raw) {
  if (raw && typeof raw === 'object') {
    return { status_name: raw.status ?? null, status_type: raw.type ?? deriveStatusType(raw.status) };
  }
  return { status_name: raw ?? null, status_type: deriveStatusType(raw) };
}

function resolveDropdown(field) {
  if (!field || field.value == null) return null;
  const options = field.type_config?.options ?? [];
  const v = field.value;
  const opt =
    options.find((o) => sameId(o?.id, v)) ||
    options.find((o) => String(o?.orderindex) === String(v)) ||
    options[Number(v)];
  if (!opt) return null;
  return opt.name ?? opt.label ?? null;
}

function subtaskRatio(hydrated) {
  const subs = Array.isArray(hydrated?.subtasks) ? hydrated.subtasks : [];
  if (!subs.length) return 0;
  const closed = subs.filter((s) => {
    const st = s?.status;
    if (st && typeof st === 'object') return st.type === 'closed';
    return typeof st === 'string' && st.toLowerCase() === 'closed';
  }).length;
  return Math.round((closed / subs.length) * 100);
}

function toEpochOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildEntry(lightTask, hydrated, opts) {
  const { userId, responsableFieldId, tipoFieldId, closedLikeLower, statusPctMap } = opts;
  const rawStatus = hydrated?.status ?? lightTask.status;
  const { status_name, status_type } = normalizeStatus(rawStatus);
  const task_type = tipoFieldId && hydrated ? resolveDropdown(customField(hydrated, tipoFieldId)) : null;
  const entry = {
    clickup_id: lightTask.id,
    name: hydrated?.name ?? lightTask.name,
    url: hydrated?.url ?? lightTask.url,
    percentage: subtaskRatio(hydrated),
    status_type,
    status_name,
    task_type,
    due_date: hydrated?.due_date ?? lightTask.due_date ?? null,
    date_closed: toEpochOrNull(hydrated?.date_closed ?? lightTask.date_closed),
    date_updated: toEpochOrNull(hydrated?.date_updated),
    source: 'clickup-only',
    slug: null,
    pr_urls: [],
  };
  entry.percentage = statusToPercentage(entry, closedLikeLower, statusPctMap);
  return entry;
}

function assemble({ list, hydrated, pluginTasks, userId, responsableFieldId, tipoFieldId, closedLikeLower, statusPctMap }) {
  const hydratedById = new Map();
  for (const h of hydrated) {
    if (h && h.id != null && !hydratedById.has(String(h.id))) hydratedById.set(String(h.id), h);
  }
  const pluginIds = new Set(pluginTasks.map((p) => String(p.clickup_id)));
  const seen = new Set();
  const out = [];
  for (const t of list) {
    if (!t || t.id == null) continue;
    const id = String(t.id);
    if (pluginIds.has(id) || seen.has(id)) continue;
    const h = hydratedById.get(id) ?? null;
    const owned = isAssignee(t, userId) || isResponsable(h, userId, responsableFieldId);
    if (!owned) continue;
    seen.add(id);
    out.push(buildEntry(t, h, { userId, responsableFieldId, tipoFieldId, closedLikeLower, statusPctMap }));
  }
  for (const p of pluginTasks) out.push(p);
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const list = loadArrayOrDie(args.list, '--list');
  const hydrated = [
    ...loadOptionalArray(args.hydrated, '--hydrated'),
    ...(args.hydratedDir ? gatherHydratedDir(args.hydratedDir) : []),
  ];
  const pluginTasks = loadOptionalArray(args.pluginTasks, '--plugin-tasks');
  const closedLikeLower = loadClosedLikeStatuses(args.closedLike);
  const statusPctMap = loadStatusPercentages(args.statusPercentages);
  const result = assemble({
    list,
    hydrated,
    pluginTasks,
    userId: args.userId,
    responsableFieldId: args.responsableFieldId,
    tipoFieldId: args.tipoFieldId,
    closedLikeLower,
    statusPctMap,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main();
