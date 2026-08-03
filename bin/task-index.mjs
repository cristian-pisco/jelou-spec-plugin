#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { normalizeDate } from './lib/task-index/extract.mjs';
import { deriveTask, filterTasks, listTaskLocations, scanWorkspace } from './lib/task-index/scan.mjs';
import {
  exitQuietlyOnBrokenPipe,
  paginate,
  renderCard,
  renderPageFooter,
  renderTable,
  runPager,
  writeFlushed,
} from './lib/task-index/render.mjs';
import { resolveSpecWorkspace } from './lib/task-index/workspace.mjs';

const COMMANDS = ['list', 'get'];
const FILTER_FLAGS = ['status', 'sprint', 'service', 'since'];

const EXIT = {
  ok: 0,
  ioError: 1,
  noWorkspace: 2,
  notFound: 6,
  ambiguous: 7,
  usage: 64,
};

const USAGE = [
  'usage: task-index.mjs <command> [options]',
  '',
  'commands:',
  '  list [--status <state>] [--sprint <n>] [--service <id>] [--since <date>]',
  '       [--page <n>] [--page-size <n>]',
  '  get <slug|<date-iso>/<slug>>',
  '',
  'options (both commands):',
  '  --workspace <path>   spec workspace root (defaults to a resolved .spec-workspace)',
  '  --cwd <path>         directory to resolve the workspace from',
  '  --json               machine readable output',
].join('\n');

export function shouldRunInteractive({ stdoutIsTTY, stdinIsTTY, json, pageGiven }) {
  return Boolean(stdoutIsTTY && stdinIsTTY && !json && !pageGiven);
}

export function resolveIdentifier(tasks, identifier) {
  const keyed = tasks.filter((task) => {
    if (task.task_key === identifier) return true;
    return `${task.date_on_disk}/${task.slug}` === identifier;
  });
  if (keyed.length === 1) return { status: 'found', task: keyed[0] };
  if (keyed.length > 1) return { status: 'ambiguous', candidates: keyed.map((task) => task.task_key) };

  const bySlug = tasks.filter((task) => task.slug === identifier);
  if (bySlug.length === 1) return { status: 'found', task: bySlug[0] };
  if (bySlug.length > 1) return { status: 'ambiguous', candidates: bySlug.map((task) => task.task_key) };
  return { status: 'not_found' };
}

function parseArgs(argv) {
  const args = { json: false, filters: {}, positional: [] };
  for (let i = 3; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--json') args.json = true;
    else if (flag === '--workspace') args.workspace = argv[++i];
    else if (flag === '--cwd') args.cwd = argv[++i];
    else if (flag === '--page') args.page = argv[++i];
    else if (flag === '--page-size') args.pageSize = argv[++i];
    else if (flag.startsWith('--') && FILTER_FLAGS.includes(flag.slice(2))) args.filters[flag.slice(2)] = argv[++i];
    else if (flag.startsWith('--')) args.unknownFlag = flag;
    else args.positional.push(flag);
  }
  return args;
}

function listRowJson(task) {
  return {
    slug: task.slug,
    date: task.date_on_disk,
    date_iso: task.date,
    task_key: task.task_key,
    title: task.title,
    title_confidence: task.title_confidence,
    status: task.status,
    status_confidence: task.status_confidence,
    setup_mode: task.setup_mode,
    setup_mode_confidence: task.setup_mode_confidence,
    sprint: task.sprint,
    services: task.service_ids,
    service_roles: task.services,
    pull_requests: task.pull_requests,
    root_path: task.root_path,
    phase_count: task.phases.length,
    derivation_issue_count: task.derivation_issues.length,
  };
}

function getTaskJson(task) {
  const tasksSource = task.sources.tasks;
  const specSource = task.sources.spec;
  const fromTasks = tasksSource ? { path: tasksSource.path, sha256: tasksSource.sha256 } : null;
  const fromSpec = specSource ? { path: specSource.path, sha256: specSource.sha256 } : null;
  return {
    task_key: task.task_key,
    date: task.date,
    date_on_disk: task.date_on_disk,
    slug: task.slug,
    root_path: task.root_path,
    title: task.title,
    title_confidence: task.title_confidence,
    status: task.status,
    status_confidence: task.status_confidence,
    setup_mode: task.setup_mode,
    setup_mode_confidence: task.setup_mode_confidence,
    sprint: task.sprint,
    services: task.services,
    pull_requests: task.pull_requests,
    phases: task.phases,
    phase_grammar: task.phase_grammar,
    lifecycle: task.lifecycle,
    external_refs: task.external_refs,
    derivation_issues: task.derivation_issues,
    provenance: {
      title: fromSpec,
      status: fromTasks,
      setup_mode: fromTasks,
      sprint: fromTasks,
      services: fromTasks,
      pull_requests: fromTasks,
      phases: fromTasks,
      lifecycle: fromTasks,
      external_refs: fromTasks,
    },
  };
}

function nextPageCommand(argv, args, view) {
  const parts = ['node', argv[1], 'list'];
  if (args.workspace) parts.push('--workspace', args.workspace);
  if (args.cwd) parts.push('--cwd', args.cwd);
  for (const flag of FILTER_FLAGS) {
    if (args.filters[flag] !== undefined) parts.push(`--${flag}`, args.filters[flag]);
  }
  parts.push('--page', String(view.page + 1), '--page-size', String(view.pageSize));
  return parts.join(' ');
}

function fail(message, code) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function emit(text) {
  return writeFlushed(process.stdout, `${text}\n`);
}

function resolveWorkspaceOrExit(args) {
  if (args.workspace) return args.workspace;
  const startDir = args.cwd || process.cwd();
  const resolved = resolveSpecWorkspace(startDir);
  if (resolved) return resolved;
  fail(
    `error: no spec workspace found. Looked for a .spec-workspace.json pointer, or a .spec-workspace/specs/ directory, walking up from ${startDir}. Pass --workspace <path> to name it explicitly.`,
    EXIT.noWorkspace,
  );
  return null;
}

async function runList(argv, args, tasks) {
  const rows = filterTasks(tasks, args.filters);
  const pageSize = args.pageSize === undefined ? 20 : Number(args.pageSize);
  const interactive = shouldRunInteractive({
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    json: args.json,
    pageGiven: args.page !== undefined,
  });

  if (interactive) {
    await runPager({ rows, out: process.stdout, keys: process.stdin, pageSize });
    return EXIT.ok;
  }

  if (args.json && args.page === undefined && args.pageSize === undefined) {
    await emit(JSON.stringify(rows.map(listRowJson)));
    return EXIT.ok;
  }

  const view = paginate(rows, args.page === undefined ? 1 : Number(args.page), pageSize);
  if (args.json) {
    await emit(JSON.stringify(view.rows.map(listRowJson)));
    return EXIT.ok;
  }

  const lines = [renderTable(view.rows, process.stdout.columns), renderPageFooter(view)];
  if (view.page < view.pages) lines.push(`siguiente: ${nextPageCommand(argv, args, view)}`);
  await emit(lines.join('\n'));
  return EXIT.ok;
}

async function runGet(args, workspace) {
  const identifier = args.positional[0];
  const resolved = resolveIdentifier(listTaskLocations(workspace), identifier);

  if (resolved.status === 'ambiguous') {
    if (args.json) await emit(JSON.stringify({ error: 'ambiguous', candidates: resolved.candidates }));
    process.stderr.write(
      `error: '${identifier}' matches ${resolved.candidates.length} tasks. Pass the full key:\n${resolved.candidates
        .map((key) => `  ${key}`)
        .join('\n')}\n`,
    );
    return EXIT.ambiguous;
  }

  if (resolved.status === 'not_found') {
    if (args.json) await emit(JSON.stringify({ error: 'not_found', identifier }));
    process.stderr.write(`error: no task matches '${identifier}' in this workspace.\n`);
    return EXIT.notFound;
  }

  const task = deriveTask(workspace, resolved.task.date_on_disk, resolved.task.slug);
  await emit(args.json ? JSON.stringify(getTaskJson(task)) : renderCard(task));
  return EXIT.ok;
}

async function main(argv) {
  exitQuietlyOnBrokenPipe(process.stdout, (error) => fail(`error: cannot write to stdout: ${error.message}`, EXIT.ioError));

  const command = argv[2];
  if (command === '--help' || command === '-h' || command === 'help') {
    await emit(USAGE);
    return EXIT.ok;
  }
  if (!COMMANDS.includes(command)) fail(`error: unknown command '${command ?? ''}'\n${USAGE}`, EXIT.usage);

  const args = parseArgs(argv);
  if (args.unknownFlag) fail(`error: unknown option ${args.unknownFlag}\n${USAGE}`, EXIT.usage);
  if (command === 'get' && !args.positional.length) fail(`error: get needs a slug or key\n${USAGE}`, EXIT.usage);
  if (args.filters.since && normalizeDate(args.filters.since) === null) {
    fail(`error: --since expects YYYY-MM-DD or DD-MM-YYYY, got '${args.filters.since}'\n${USAGE}`, EXIT.usage);
  }

  const workspace = resolveWorkspaceOrExit(args);

  let code;
  try {
    code = command === 'list' ? await runList(argv, args, scanWorkspace(workspace).tasks) : await runGet(args, workspace);
  } catch (error) {
    fail(`error: cannot read ${workspace}: ${error.message}`, EXIT.ioError);
  }

  return code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv).then((code) => {
    process.exitCode = code;
  });
}
