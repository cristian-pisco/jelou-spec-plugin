#!/usr/bin/env node

import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `phase-open.mjs — one call per phase start for execute-task Step 7c.

Chains, in this order: bin/classify-phase.sh mode (docs vs tdd),
bin/build-dispatch-prompt.mjs (tdd only), bin/phase-state.mjs --event=start.

  --task-dir=<abs path>        REQUIRED (holds TASKS.md)
  --service=<service-id>       REQUIRED
  --phase=<NN>                 REQUIRED
  --phase-file=<abs path>      REQUIRED
  --phase-title=<text>         heading used when the phase entry has to be created
  --plugin-root=<abs path>     REQUIRED for the dispatch prompt
  --services-in-phase=<K>      defaults to 1
  --docs-file=<abs path>       service docs cache, inlined as ## SERVICE DOCS
  --notes-file=<abs path>      rendered as ## ORCHESTRATOR NOTES

Trace flags (omit them entirely when tracing is off — the trace layer is then never loaded):
  --span-parent=<workflow span id> --span-trace=<trace id> --task-slug=<slug>

Output: key=value lines on stdout. When mode=tdd the last line of the header is
\`prompt=below\`, followed by the delimiter line and the dispatch prompt verbatim
to end of stream. Exit 0 on success, 1 with status=abort + reason=<machine-readable>.`;

const PROMPT_DELIMITER = '----- DISPATCH PROMPT -----';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function abort(reason, message) {
  process.stdout.write('status=abort\n');
  process.stdout.write(`reason=${reason}\n`);
  process.stderr.write(`phase-open: ${message}\n`);
  process.exit(1);
}

function parseKeyValues(stdout) {
  const out = {};
  for (const line of String(stdout).split('\n')) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function run(command, argsList, options) {
  return spawnSync(command, argsList, { encoding: 'utf8', ...options });
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const binDir = dirname(fileURLToPath(import.meta.url));

for (const required of ['task-dir', 'service', 'phase', 'phase-file', 'plugin-root']) {
  if (!args[required] || args[required] === true) {
    abort('missing_argument', `--${required} required`);
  }
}

const taskDir = resolve(args['task-dir']);
if (!existsSync(taskDir) || !statSync(taskDir).isDirectory()) {
  abort('task_dir_missing', `task dir not found: ${taskDir}`);
}

const phaseFile = resolve(args['phase-file']);
if (!existsSync(phaseFile) || !statSync(phaseFile).isFile()) {
  abort('phase_file_missing', `phase file not found: ${phaseFile}`);
}

const servicesInPhase = args['services-in-phase'] && args['services-in-phase'] !== true
  ? String(args['services-in-phase'])
  : '1';

const classify = run('bash', [join(binDir, 'classify-phase.sh'), 'mode'], {
  env: {
    ...process.env,
    CLASSIFY_PHASE_FILE: phaseFile,
    CLASSIFY_SERVICES_IN_PHASE: servicesInPhase,
  },
});
if (classify.status !== 0) {
  abort('classify_failed', `classify-phase.sh mode exited ${classify.status}: ${classify.stderr}`);
}
const mode = parseKeyValues(classify.stdout);

let prompt = null;
if (mode.mode !== 'docs') {
  const promptArgs = [
    join(binDir, 'build-dispatch-prompt.mjs'),
    '--agent=tdd-cycle',
    `--task-dir=${taskDir}`,
    `--service=${args.service}`,
    `--plugin-root=${args['plugin-root']}`,
    `--phase-file=${phaseFile}`,
  ];
  if (args['docs-file'] && args['docs-file'] !== true) promptArgs.push(`--docs-file=${args['docs-file']}`);
  if (args['notes-file'] && args['notes-file'] !== true) promptArgs.push(`--notes-file=${args['notes-file']}`);

  const built = run(process.execPath, promptArgs);
  if (built.status !== 0) {
    abort('prompt_build_failed', `build-dispatch-prompt.mjs exited ${built.status}: ${built.stderr}`);
  }
  prompt = built.stdout.replace(/\n+$/, '');
}

const stateArgs = [
  join(binDir, 'phase-state.mjs'),
  '--event=start',
  `--task-dir=${taskDir}`,
  `--service=${args.service}`,
  `--phase=${args.phase}`,
  `--phase-file=${phaseFile}`,
];
if (args['phase-title'] && args['phase-title'] !== true) stateArgs.push(`--phase-title=${args['phase-title']}`);
for (const flag of ['span-parent', 'span-trace', 'task-slug']) {
  if (args[flag] && args[flag] !== true) stateArgs.push(`--${flag}=${args[flag]}`);
}

const state = run(process.execPath, stateArgs);
const stateOut = parseKeyValues(state.stdout);
if (state.status !== 0) {
  abort(stateOut.reason || 'phase_state_failed', `phase-state.mjs --event=start failed: ${state.stderr}`);
}

const emitted = [
  'status=ok',
  `phase=${args.phase}`,
  `service=${args.service}`,
  `mode=${mode.mode}`,
  `fr_nfr_count=${mode.fr_nfr_count ?? ''}`,
  `frontmatter_override=${mode.frontmatter_override ?? 'none'}`,
  `mode_reason=${mode.reason ?? ''}`,
];
if (mode.docs_rejection_reason) emitted.push(`docs_rejection_reason=${mode.docs_rejection_reason}`);
emitted.push(
  `phase_status=${stateOut.phase_status ?? ''}`,
  `started_at=${stateOut.started_at ?? ''}`,
  `grammar=${stateOut.grammar ?? ''}`,
  `tasks_md=${stateOut.tasks_md ?? ''}`,
  `phase_file=${stateOut.phase_file ?? ''}`,
);
if (stateOut.span_id) emitted.push(`span_id=${stateOut.span_id}`, `trace_id=${stateOut.trace_id ?? ''}`);
emitted.push(`prompt=${prompt === null ? 'none' : 'below'}`);

process.stdout.write(`${emitted.join('\n')}\n`);
if (prompt !== null) process.stdout.write(`${PROMPT_DELIMITER}\n${prompt}\n`);
