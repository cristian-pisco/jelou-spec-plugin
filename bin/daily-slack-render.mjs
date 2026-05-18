#!/usr/bin/env node
// bin/daily-slack-render.mjs
//
// Renders the three automated placeholders for the daily Slack report from
// a JSON input file. Outputs {achieved_goals, not_achieved_goals,
// short_term_goals} as JSON on stdout.
//
// Output uses *standard markdown* (not Slack mrkdwn) so the resulting body
// renders correctly through `mcp__plugin_slack_slack__slack_send_message`,
// which expects standard markdown. Concretely:
//   - bold:           **text**     (single `*text*` would render as italic)
//   - strikethrough:  ~~text~~     (single `~text~` would render as plain)
//   - italic:         _text_       (works in both standard markdown and mrkdwn)
//   - link:           <url|name>   (Slack-flavored hyperlink, preserved verbatim)
//
// Channel templates (`registry/slack/<channel>.md`) MUST also use `**bold**`
// — see jelou/templates/slack-channel.md for the canonical format.
//
// Usage:
//   node bin/daily-slack-render.mjs --data <path> [--closed-like-statuses <path>]

import { readOrDie, parseJsonOrDie } from './lib/daily-slack-helpers.mjs';
import { isClosedLike, loadClosedLikeStatuses } from './lib/daily-slack-status.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--data') args.data = argv[++i];
    else if (argv[i] === '--closed-like-statuses') args.closedLike = argv[++i];
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

const ISSUES_HEADER = '- :ladybug: Issues';
const TAREAS_HEADER = '- :clipboard: Tareas';
const MEETS_HEADER = '- :calendar: Meets';
const SUB_BULLET = '   * ';

function slackLink(url, text) {
  return `<${url}|${text}>`;
}

function isIssue(task) {
  return typeof task?.task_type === 'string' && task.task_type.toLowerCase() === 'issue';
}

function parseMeetingsLines(meetings) {
  if (typeof meetings !== 'string' || !meetings.trim()) return [];
  return meetings
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderTaskItem(t) {
  return `${SUB_BULLET}\`[${t.percentage}%]\` ${slackLink(t.url, t.name)}`;
}

// Splits `achieved` into Issues / Tareas buckets via `task_type` (case-insensitive
// match against "issue" — anything else, including missing `task_type`, falls
// into Tareas). The manual `meetings` text is parsed line-by-line (each non-blank
// line becomes one bullet). Sections render only when non-empty so the reader
// never sees a stray header above an empty list.
//
// First-run banner only kicks in when every bucket is empty — if the user
// captured meetings on their first run, those still surface, the banner doesn't.
function renderAchieved(achieved, firstRun, meetings) {
  const issues = achieved.filter(isIssue);
  const tasks = achieved.filter((t) => !isIssue(t));
  const meets = parseMeetingsLines(meetings);
  if (!issues.length && !tasks.length && !meets.length) {
    return firstRun ? FIRST_RUN_BANNER : ACHIEVED_EMPTY;
  }
  const sections = [];
  if (issues.length) {
    sections.push(`${ISSUES_HEADER}\n${issues.map(renderTaskItem).join('\n')}`);
  }
  if (tasks.length) {
    sections.push(`${TAREAS_HEADER}\n${tasks.map(renderTaskItem).join('\n')}`);
  }
  if (meets.length) {
    sections.push(`${MEETS_HEADER}\n${meets.map((m) => `${SUB_BULLET}${m}`).join('\n')}`);
  }
  return sections.join('\n');
}

function renderNotAchieved(not_achieved) {
  if (!not_achieved.length) return NOT_ACHIEVED_EMPTY;
  return not_achieved.map((t) => `${t.name} — ${t.reason}\n${t.url}`).join('\n\n');
}

// `due_date` may arrive as either an ISO timestamp (`"2026-04-30T00:00:00Z"`)
// or as a ClickUp-style epoch-millisecond value (string `"1778490000000"` or
// a raw number). Normalize both into a `YYYY-MM-DD` slice so the renderer
// never leaks raw epoch digits into Slack.
function isoDate(s) {
  if (s == null) return '';
  if (typeof s === 'number') return new Date(s).toISOString().slice(0, 10);
  const str = String(s);
  if (/^-?\d+$/.test(str)) return new Date(Number(str)).toISOString().slice(0, 10);
  return str.slice(0, 10);
}

const STATUS_ACRONYMS = new Set(['qa', 'pr', 'ui', 'ux', 'api', 'mcp', 'poc', 'rfc', 'sdk']);

function titleCase(s) {
  return String(s)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase();
      if (STATUS_ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower[0].toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

// Groups every task in the sprint union by `status_name` and renders each
// group under a bold header so the daily reader sees, at a glance, where
// every task currently lives — not just the deltas. Tasks without a
// `status_name` are skipped (the renderer can't label them).
//
// Group order: descending max percentage, ties broken alphabetically by
// display label. Within a group: descending percentage, ties broken by
// case-insensitive task name.
function renderTasksByStatus(all_tasks) {
  if (!Array.isArray(all_tasks) || all_tasks.length === 0) return '';
  const groups = new Map();
  for (const t of all_tasks) {
    const raw = t.status_name == null ? '' : String(t.status_name).trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { label: titleCase(raw), max: -1, tasks: [] };
      groups.set(key, g);
    }
    const pct = Number.isFinite(t.percentage) ? t.percentage : 0;
    if (pct > g.max) g.max = pct;
    g.tasks.push({ name: t.name, url: t.url, percentage: pct });
  }
  const ordered = [...groups.values()].sort((a, b) => {
    if (b.max !== a.max) return b.max - a.max;
    return a.label.localeCompare(b.label);
  });
  return ordered
    .map((g) => {
      const sorted = g.tasks.sort((a, b) => {
        if (b.percentage !== a.percentage) return b.percentage - a.percentage;
        return String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase());
      });
      const lines = sorted.map((t) => `\`[${t.percentage}%]\` ${slackLink(t.url, t.name)}`).join('\n');
      return `**${g.label}**\n${lines}`;
    })
    .join('\n\n');
}

// Closed-like items wrap the ENTIRE line (date + link) in `~~...~~` so the
// strikethrough visually covers the date too — readers expect `[2026-04-27]
// done thing` to be one struck unit, not just the link.
//
// Open items optionally append ` — _<status_note>_` so the daily reader can
// see at a glance why the item is still on the radar (pending prod, on hold,
// in QA). The note must be set by the orchestrator from ClickUp status +
// recent comments; the renderer just italicizes it verbatim.
function renderShortTerm(short_term, closedLike) {
  const withDates = short_term.filter((t) => t.due_date);
  withDates.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
  return withDates
    .map((t) => {
      const date = `\`[${isoDate(t.due_date)}]\``;
      const link = slackLink(t.url, t.name);
      if (isClosedLike(t, closedLike)) return `~~${date} ${link}~~`;
      const note = typeof t.status_note === 'string' && t.status_note.trim() ? t.status_note.trim() : '';
      return note ? `${date} ${link} — _${note}_` : `${date} ${link}`;
    })
    .join('\n');
}

function main() {
  const { data, closedLike } = parseArgs(process.argv);
  const d = parseJsonOrDie(readOrDie(data, '--data'), '--data');
  const closedLikeStatuses = loadClosedLikeStatuses(closedLike);
  const out = {
    achieved_goals: renderAchieved(d.achieved || [], !!d.first_run, d.meetings),
    not_achieved_goals: renderNotAchieved(d.not_achieved || []),
    short_term_goals: renderShortTerm(d.short_term || [], closedLikeStatuses),
    tasks_by_status: renderTasksByStatus(d.all_tasks || []),
  };
  process.stdout.write(JSON.stringify(out) + '\n');
}

main();
