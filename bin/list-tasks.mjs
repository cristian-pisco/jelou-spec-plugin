#!/usr/bin/env node
// bin/list-tasks.mjs
//
// Lists local tasks created by /jlu-new-task. Scans <workspace>/specs/<date>/<slug>/
// for task directories (those containing a TASKS.md), then parses lifecycle state,
// sprint, and affected services from TASKS.md and the title from SPEC.md.
//
// TASKS.md has drifted across two on-disk schemas; both are parsed:
//   - canonical (/jlu-new-task): `## Status: <state>`, `## Services` with
//     `- Primary:` / `- Affected:`, `- Sprint: <n>`
//   - alternative: `## Status` section with `- **Lifecycle**: <state>`, a
//     YAML frontmatter `affected_services:` list, `- **Sprint**: <n>`
//
// Usage:
//   node bin/list-tasks.mjs [--workspace <path>] [--cwd <path>] [--status <state>] [--json]
//
// Output (stdout): a rendered table by default, or a JSON array with --json. Each
// task is { slug, date, title, status, sprint, services }.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_WALK_UP = 6;

export function resolveWorkspace(startDir) {
  let dir = startDir;
  for (let i = 0; i <= MAX_WALK_UP; i++) {
    const pointer = join(dir, '.spec-workspace.json');
    if (existsSync(pointer)) {
      try {
        const ws = JSON.parse(readFileSync(pointer, 'utf8'))?.workspace;
        if (ws && existsSync(join(ws, 'specs'))) return ws;
      } catch {
        // malformed pointer — fall through to directory probing
      }
    }
    const local = join(dir, '.spec-workspace');
    if (existsSync(join(local, 'specs'))) return local;

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readMarkerValue(text, label) {
  const re = new RegExp(`^-\\s+\\*?\\*?${label}\\*?\\*?:\\s*(\\S.*)$`, 'im');
  const m = text.match(re);
  return m ? m[1].replace(/\*\*/g, '').trim() : null;
}

function parseStatus(text) {
  const inline = text.match(/^##\s+Status:\s*(\S.*)$/im);
  if (inline) return inline[1].replace(/\*\*/g, '').trim().toLowerCase();
  const lifecycle = readMarkerValue(text, 'Lifecycle');
  if (lifecycle) return lifecycle.toLowerCase();
  const status = readMarkerValue(text, 'Status');
  if (status) return status.toLowerCase();
  return 'unknown';
}

function parseFrontmatterServices(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return [];
  const block = fm[1];
  const start = block.search(/^affected_services:\s*$/im);
  if (start === -1) return [];
  const ids = [];
  for (const line of block.slice(start).split('\n').slice(1)) {
    if (/^\S/.test(line) && !/^\s*-/.test(line)) break; // next top-level key
    const m = line.match(/^\s*-\s+id:\s*(\S+)/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

function parseServices(text) {
  const out = [];
  const primary = readMarkerValue(text, 'Primary');
  if (primary && !primary.startsWith('(')) out.push(primary);

  const affected = readMarkerValue(text, 'Affected');
  if (affected && !affected.startsWith('(')) {
    for (const id of affected.split(',').map((s) => s.trim()).filter(Boolean)) {
      out.push(id);
    }
  }

  out.push(...parseFrontmatterServices(text));
  return [...new Set(out)];
}

function parseTitle(specText, fallback) {
  if (!specText) return fallback;
  const m = specText.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

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
        title: parseTitle(specText, slug),
        status: parseStatus(tasksText),
        sprint: readMarkerValue(tasksText, 'Sprint'),
        services: parseServices(tasksText),
      });
    }
  }

  tasks.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date)));
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

function main() {
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

  process.stdout.write((args.json ? JSON.stringify(tasks) : renderTable(tasks)) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
