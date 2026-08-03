#!/usr/bin/env node
// bin/list-tasks.mjs
//
// Lists local tasks created by /jlu-new-task. Scans <workspace>/specs/<date>/<slug>/
// for task directories (those containing a TASKS.md), then parses lifecycle state,
// sprint, and affected services from TASKS.md and the title from SPEC.md.
//
// Usage:
//   node bin/list-tasks.mjs [--workspace <path>] [--cwd <path>] [--status <state>] [--json]
//
// Output (stdout): a rendered table by default, or a JSON array with --json. Each
// task is { slug, date, title, status, sprint, services }.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDate, parseServices, parseSprint, parseStatus, parseTitle } from './lib/task-index/extract.mjs';
import { exitQuietlyOnBrokenPipe, writeFlushed } from './lib/task-index/render.mjs';
import { resolveSpecWorkspace } from './lib/task-index/workspace.mjs';

export { resolveSpecWorkspace };
export const resolveWorkspace = resolveSpecWorkspace;

export function listTasks(workspacePath) {
  const specsDir = join(workspacePath, 'specs');
  if (!existsSync(specsDir)) return [];

  const tasks = [];
  for (const date of readdirSync(specsDir)) {
    const dateDir = join(specsDir, date);
    if (!statSync(dateDir).isDirectory()) continue;
    for (const slug of readdirSync(dateDir)) {
      const taskDir = join(dateDir, slug);
      const tasksMd = join(taskDir, 'TASKS.md');
      if (!statSync(taskDir).isDirectory() || !existsSync(tasksMd)) continue;

      const tasksText = readFileSync(tasksMd, 'utf8');
      const specMd = join(taskDir, 'SPEC.md');
      const specText = existsSync(specMd) ? readFileSync(specMd, 'utf8') : '';

      tasks.push({
        slug,
        date,
        title: parseTitle(specText, slug).value,
        status: parseStatus(tasksText).value,
        sprint: parseSprint(tasksText).value,
        services: parseServices(tasksText).ids,
      });
    }
  }

  tasks.sort((a, b) => {
    const aDate = normalizeDate(a.date) ?? a.date;
    const bDate = normalizeDate(b.date) ?? b.date;
    return aDate === bDate ? a.slug.localeCompare(b.slug) : bDate.localeCompare(aDate);
  });
  return tasks;
}

export function renderTable(tasks) {
  if (!tasks.length) return 'No tasks found in this workspace.';

  const headers = ['Slug', 'Title', 'Status', 'Date', 'Sprint', 'Services'];
  const rows = tasks.map((t) => [
    t.slug,
    t.title,
    t.status,
    t.date,
    t.sprint ?? '—',
    t.services.length ? t.services.join(', ') : '—',
  ]);

  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const fmt = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');

  return [fmt(headers), sep, ...rows.map(fmt)].join('\n');
}

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--workspace') args.workspace = argv[++i];
    else if (argv[i] === '--cwd') args.cwd = argv[++i];
    else if (argv[i] === '--status') args.status = argv[++i];
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

async function main() {
  exitQuietlyOnBrokenPipe(process.stdout, (error) => {
    console.error(`error: cannot write to stdout: ${error.message}`);
    process.exit(1);
  });

  const args = parseArgs(process.argv);
  const workspace = args.workspace || resolveWorkspace(args.cwd || process.cwd());
  if (!workspace) {
    console.error('error: no workspace found. Expected --workspace, a .spec-workspace.json, or a parent .spec-workspace/specs/ directory.');
    process.exit(2);
  }

  let tasks = listTasks(workspace);
  if (args.status) {
    const want = args.status.toLowerCase();
    tasks = tasks.filter((t) => t.status === want);
  }

  await writeFlushed(process.stdout, `${args.json ? JSON.stringify(tasks) : renderTable(tasks)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
