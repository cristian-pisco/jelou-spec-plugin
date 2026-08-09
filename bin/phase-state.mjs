#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const USAGE = `phase-state.mjs — one call per phase boundary for execute-task Steps 7b / 7i+7l.

  --event=start|end        REQUIRED
  --task-dir=<abs path>    REQUIRED (holds TASKS.md)
  --phase=<NN>             REQUIRED
  --service=<service-id>   required unless --phase-file is given
  --phase-file=<abs path>  overrides the derived phase file path
  --phase-title=<text>     heading used when a phase entry has to be created
  --started-at=<iso>       start event; defaults to now
  --completed-at=<iso>     end event; defaults to now
  --status=<done|blocked|failed>   end event; defaults to done
  --tests-passed=<N> --tests-total=<N>   end event
  --artifacts=<a,b,c>      end event
  --deviations=<text>      end event
  --commit-sha=<sha>       end event
  --no-diff                end event; writes "Commit: (no diff)" (finalize-phase.sh reason=no_changes)

Trace flags (omit them entirely when tracing is off — the trace layer is then never loaded):
  start: --span-parent=<workflow span id> --span-trace=<trace id> --task-slug=<slug>
  end:   --span=<phase span id> --span-status=<ok|blocked|failed> --span-success=<pass@1|pass@k|fail> --span-attempts=<N>

Output: key=value lines on stdout. Exit 0 on success, 1 with status=abort + reason=<machine-readable> otherwise.`;

const BOOLEAN_FLAGS = new Set(['no-diff', 'help']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    if (BOOLEAN_FLAGS.has(body)) {
      out[body] = true;
      continue;
    }
    out[body] = argv[++i];
  }
  return out;
}

function abort(reason, message) {
  process.stdout.write('status=abort\n');
  process.stdout.write(`reason=${reason}\n`);
  process.stderr.write(`phase-state: ${message}\n`);
  process.exit(1);
}

function normalizePhase(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^0+(?=\d)/, '');
}

function samePhase(a, b) {
  const left = normalizePhase(a);
  const right = normalizePhase(b);
  return left !== '' && left === right;
}

function sectionBounds(lines) {
  for (const heading of ['## Phase Progress', '## Phases']) {
    const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
    if (start === -1) continue;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i]) && !/^###/.test(lines[i])) {
        end = i;
        break;
      }
    }
    return { start, end };
  }
  return null;
}

function tableCells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(line) {
  return /^\|?[\s:|-]+\|[\s:|-]*$/.test(line.trim()) && line.includes('-');
}

function tableColumns(cells) {
  const status = cells.findIndex((cell) => /^status$/i.test(cell));
  if (status === -1) return null;
  const numbered = cells.findIndex((cell) => /^(#|n|nn|no\.?)$/i.test(cell));
  const named = cells.findIndex((cell) => /^phase(\s+name)?$/i.test(cell));
  if (numbered === -1 && named === -1) return null;
  return {
    number: numbered === -1 ? named : numbered,
    status,
    started: cells.findIndex((cell) => /^started$/i.test(cell)),
    completed: cells.findIndex((cell) => /^completed$/i.test(cell)),
  };
}

function updateTable(lines, bounds, phase, updates) {
  let header = -1;
  let columns = null;
  for (let i = bounds.start + 1; i < bounds.end; i++) {
    if (!lines[i].trim().startsWith('|')) continue;
    columns = tableColumns(tableCells(lines[i]));
    if (columns) {
      header = i;
      break;
    }
  }
  if (!columns) return false;

  for (let i = header + 1; i < bounds.end; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;
    if (isSeparatorRow(line)) continue;
    const cells = tableCells(line);
    const idCell = cells[columns.number] ?? '';
    const id = idCell.match(/^0*(\d+[a-z]?)\b/i);
    if (!id || !samePhase(id[1], phase)) continue;
    cells[columns.status] = updates.status;
    if (columns.started !== -1 && updates.started) cells[columns.started] = updates.started;
    if (columns.completed !== -1 && updates.completed) cells[columns.completed] = updates.completed;
    lines[i] = `| ${cells.join(' | ')} |`;
    return true;
  }
  return false;
}

function blockHeadingIndex(lines, bounds, phase) {
  for (let i = bounds.start + 1; i < bounds.end; i++) {
    const heading = lines[i].match(/^###\s+(?:Phase|Fase)\s+0*(\d+[a-z]?)\b/i);
    if (heading && samePhase(heading[1], phase)) return i;
  }
  return -1;
}

function blockEnd(lines, bounds, headingIndex) {
  for (let i = headingIndex + 1; i < bounds.end; i++) {
    if (/^#{2,3}\s+/.test(lines[i])) return i;
  }
  return bounds.end;
}

function applyBullets(lines, headingIndex, end, fields) {
  let insertAt = headingIndex + 1;
  for (let i = headingIndex + 1; i < end; i++) {
    if (lines[i].trim().startsWith('- ')) insertAt = i + 1;
    else if (lines[i].trim() !== '') break;
  }
  for (const [label, value] of fields) {
    const bullet = `- ${label}: ${value}`;
    const pattern = new RegExp(`^-\\s+\\*{0,2}${label}\\*{0,2}:`, 'i');
    let replaced = false;
    for (let i = headingIndex + 1; i < end; i++) {
      if (!pattern.test(lines[i].trim())) continue;
      lines[i] = bullet;
      replaced = true;
      break;
    }
    if (replaced) continue;
    lines.splice(insertAt, 0, bullet);
    insertAt += 1;
    end += 1;
  }
  return end;
}

function updateTasksMd(tasksPath, phase, phaseTitle, fields, tableUpdates) {
  const original = readFileSync(tasksPath, 'utf8');
  const lines = original.split('\n');

  let bounds = sectionBounds(lines);
  if (!bounds) {
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push('## Phase Progress', '');
    bounds = { start: lines.length - 2, end: lines.length };
  }

  const grammars = [];
  if (updateTable(lines, bounds, phase, tableUpdates)) grammars.push('table');

  bounds = sectionBounds(lines);
  let headingIndex = blockHeadingIndex(lines, bounds, phase);
  if (headingIndex === -1) {
    const insertAt = bounds.end;
    const block = [];
    if (insertAt > 0 && lines[insertAt - 1].trim() !== '') block.push('');
    block.push(`### Phase ${phase}: ${phaseTitle}`);
    lines.splice(insertAt, 0, ...block, '');
    headingIndex = insertAt + block.length - 1;
    bounds = sectionBounds(lines);
  }
  applyBullets(lines, headingIndex, blockEnd(lines, bounds, headingIndex), fields);
  grammars.push('headers');

  const next = lines.join('\n');
  if (next !== original) writeFileSync(tasksPath, next, 'utf8');
  return grammars.join('+');
}

function updatePhaseFile(phaseFilePath, status) {
  const original = readFileSync(phaseFilePath, 'utf8');
  const lines = original.split('\n');
  let written = false;
  for (let i = 0; i < lines.length; i++) {
    if (!/^###\s+Status:/i.test(lines[i])) continue;
    lines[i] = `### Status: ${status}`;
    written = true;
    break;
  }
  if (!written) {
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push(`### Status: ${status}`, '');
    written = true;
  }
  const next = lines.join('\n');
  if (next !== original) writeFileSync(phaseFilePath, next, 'utf8');
  return written;
}

function derivePhaseFile(taskDir, service, phase) {
  const dir = join(taskDir, 'services', service, 'phases');
  if (!existsSync(dir)) return null;
  const wanted = normalizePhase(phase);
  const match = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .find((name) => samePhase((name.match(/^([^-]+)-/) || [])[1] ?? '', wanted));
  return match ? join(dir, match) : null;
}

function traceFilePath() {
  return process.env.TRACE_FILE || resolve(process.cwd(), '.traces', 'spans.jsonl');
}

async function openPhaseSpan(args) {
  const { startSpan } = await import('./lib/trace/emitter.mjs');
  return startSpan(traceFilePath(), {
    scope: 'task',
    name: 'phase',
    parent_span_id: args['span-parent'] || undefined,
    trace_id: args['span-trace'] || undefined,
    task_slug: args['task-slug'] || undefined,
    service_id: args.service || undefined,
    phase_num: Number.isNaN(Number(args.phase)) ? undefined : Number(args.phase),
  });
}

async function closePhaseSpan(args) {
  const file = traceFilePath();
  const [{ appendSpan }, { readSpans, listRotatedFiles }, { EVENT_KIND, ATTR }] = await Promise.all([
    import('./lib/trace/emitter.mjs'),
    import('./lib/trace/reader.mjs'),
    import('./lib/trace/schema.mjs'),
  ]);

  let start = null;
  for (const rotated of listRotatedFiles(file)) {
    for (const event of readSpans(rotated, {
      filter: (e) => e.event_kind === EVENT_KIND.SPAN_START && e.span_id === args.span,
    })) {
      start = event;
      break;
    }
    if (start) break;
  }

  const attrs = {};
  if (args['span-success']) attrs[ATTR.SUCCESS] = args['span-success'];
  if (args['span-attempts'] != null) attrs[ATTR.ATTEMPTS_TO_GREEN] = Number(args['span-attempts']);
  if (!start) attrs.unmatched_start = true;

  appendSpan(file, {
    event_kind: EVENT_KIND.SPAN_END,
    span_id: args.span,
    trace_id: start ? start.trace_id : undefined,
    parent_span_id: start ? start.parent_span_id : undefined,
    scope: start ? start.scope : 'task',
    name: start ? start.name : 'phase',
    task_slug: start ? start.task_slug : args['task-slug'] || undefined,
    service_id: start ? start.service_id : args.service || undefined,
    phase_num: start ? start.phase_num : undefined,
    duration_ms: start ? Date.now() - new Date(start.ts).getTime() : undefined,
    status: args['span-status'],
    attrs: Object.keys(attrs).length ? attrs : undefined,
  });
}

const END_STATUSES = new Set(['done', 'blocked', 'failed']);
const SPAN_STATUS_BY_PHASE_STATUS = { done: 'ok', blocked: 'blocked', failed: 'failed' };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }

  const event = args.event;
  if (event !== 'start' && event !== 'end') abort('invalid_event', '--event must be start or end');
  if (!args['task-dir']) abort('missing_task_dir', '--task-dir required');
  if (!args.phase) abort('missing_phase', '--phase required');

  const taskDir = resolve(args['task-dir']);
  if (!existsSync(taskDir)) abort('task_dir_missing', `task dir not found: ${taskDir}`);

  const tasksPath = join(taskDir, 'TASKS.md');
  if (!existsSync(tasksPath)) abort('tasks_md_missing', `TASKS.md not found: ${tasksPath}`);

  let phaseFile = args['phase-file'] ? resolve(args['phase-file']) : null;
  if (!phaseFile) {
    if (!args.service) abort('missing_service', '--service required when --phase-file is absent');
    phaseFile = derivePhaseFile(taskDir, args.service, args.phase);
  }
  if (!phaseFile || !existsSync(phaseFile)) {
    abort('phase_file_missing', `phase file not found for phase ${args.phase}`);
  }

  if (args['commit-sha'] && args['no-diff']) {
    abort('conflicting_commit_inputs', '--commit-sha and --no-diff are mutually exclusive');
  }

  const phaseTitle = args['phase-title'] || `Phase ${args.phase}`;
  const emitted = [`status=ok`, `event=${event}`, `phase=${args.phase}`];

  if (event === 'start') {
    const startedAt = args['started-at'] || new Date().toISOString();
    updatePhaseFile(phaseFile, 'in_progress');
    const grammar = updateTasksMd(
      tasksPath,
      args.phase,
      phaseTitle,
      [['Status', 'in_progress'], ['Started', startedAt]],
      { status: 'in_progress', started: startedAt },
    );
    emitted.push(`phase_status=in_progress`, `started_at=${startedAt}`, `grammar=${grammar}`);

    if (args['span-parent'] || args['span-trace']) {
      const span = await openPhaseSpan(args);
      emitted.push(`span_id=${span.span_id}`, `trace_id=${span.trace_id}`);
    }
  } else {
    const status = args.status || 'done';
    if (!END_STATUSES.has(status)) {
      abort('invalid_status', `--status must be one of ${[...END_STATUSES].join('|')}`);
    }
    const completedAt = args['completed-at'] || new Date().toISOString();
    const fields = [['Status', status]];
    if (args['tests-passed'] != null && args['tests-total'] != null) {
      fields.push(['Tests', `${args['tests-passed']}/${args['tests-total']} passing`]);
    }
    if (args['no-diff']) fields.push(['Commit', '(no diff)']);
    else if (args['commit-sha']) fields.push(['Commit', args['commit-sha']]);
    fields.push(['Completed', completedAt]);
    if (args.artifacts) {
      fields.push(['Artifacts', args.artifacts.split(',').map((a) => a.trim()).filter(Boolean).join(', ')]);
    }
    if (args.deviations) fields.push(['Deviations', args.deviations]);

    updatePhaseFile(phaseFile, status);
    const grammar = updateTasksMd(tasksPath, args.phase, phaseTitle, fields, {
      status,
      completed: completedAt,
    });
    emitted.push(`phase_status=${status}`, `completed_at=${completedAt}`, `grammar=${grammar}`);
    emitted.push(`commit=${args['no-diff'] ? '(no diff)' : args['commit-sha'] || ''}`);

    if (args.span) {
      args['span-status'] = args['span-status'] || SPAN_STATUS_BY_PHASE_STATUS[status];
      await closePhaseSpan(args);
      emitted.push(`span_closed=true`);
    }
  }

  emitted.push(`tasks_md=${tasksPath}`, `phase_file=${phaseFile}`);
  process.stdout.write(`${emitted.join('\n')}\n`);
}

main().catch((err) => {
  abort('unexpected_error', err && err.stack ? err.stack : String(err));
});
