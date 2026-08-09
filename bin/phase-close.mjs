#!/usr/bin/env node

import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCommand, defaultResolveScript } from './guard-test-commands.mjs';

const USAGE = `phase-close.mjs — one call per phase end for execute-task Step 7e.

Chains, in this order: bin/format-changed-files.sh, the optional Green re-check,
bin/classify-phase.sh all (post-Green triviality against the real diff),
bin/finalize-phase.sh (scope check + stage + commit), bin/phase-state.mjs --event=end.

  --task-dir=<abs path>          REQUIRED (holds TASKS.md)
  --service=<service-id>         REQUIRED
  --phase=<NN>                   REQUIRED
  --phase-file=<abs path>        REQUIRED
  --phase-title=<text>           REQUIRED (commit subject body + TASKS.md heading)
  --source-path=<abs path>       REQUIRED (service worktree or repo root)
  --task-slug=<slug>             REQUIRED (branch invariant: production/<slug>)
  --commit-type=<feat|fix|docs|refactor|test>   REQUIRED unless --docs
  --changed-files=<a,b,c>        REQUIRED unless --docs (Files Modified + Tests Written)
  --services-in-phase=<K>        defaults to 1
  --conventions=<abs path>       optional CONVENTIONS.md for format detection
  --green-recheck-command=<cmd>  re-run when the formatter rewrote a file
  --status=<done|blocked|failed> defaults to done
  --tests-passed=<N> --tests-total=<N>
  --artifacts=<a,b,c> --deviations=<text>
  --docs                         docs-mode phase: scope is derived from the diff and
                                 must be documentation-only; no format, no triviality

Trace flags (omit them entirely when tracing is off):
  --span=<phase span id> --span-status=<ok|blocked|failed>
  --span-success=<pass@1|pass@k|fail> --span-attempts=<N>

Output: key=value lines on stdout. Exit 0 on success, non-zero with
status=abort + reason=<machine-readable> otherwise.`;

const DOC_PATTERNS = [
  /\.mdx?$/i,
  /\.txt$/i,
  /\.rst$/i,
  /(^|\/)README/i,
  /(^|\/)CHANGELOG/i,
  /(^|\/)docs\//i,
  /(^|\/)verification\.md$/i,
];

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function emit(lines) {
  process.stdout.write(`${lines.join('\n')}\n`);
}

function abort(lines, reason, message, code = 1) {
  emit([...lines, 'status=abort', `reason=${reason}`]);
  process.stderr.write(`phase-close: ${message}\n`);
  process.exit(code);
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
  return spawnSync(command, argsList, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
}

function splitList(value) {
  if (!value || value === true) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function tail(text, lineCount) {
  return String(text ?? '').split('\n').slice(-lineCount).join('\n').trim();
}

function gitLines(sourcePath, gitArgs) {
  const result = run('git', ['-C', sourcePath, ...gitArgs]);
  if (result.status !== 0) return null;
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const binDir = dirname(fileURLToPath(import.meta.url));
const docsMode = args.docs === true;
const header = [];

for (const required of ['task-dir', 'service', 'phase', 'phase-file', 'phase-title', 'source-path', 'task-slug']) {
  if (!args[required] || args[required] === true) abort(header, 'missing_argument', `--${required} required`);
}
if (!docsMode) {
  for (const required of ['commit-type', 'changed-files']) {
    if (!args[required] || args[required] === true) abort(header, 'missing_argument', `--${required} required`);
  }
}

const taskDir = resolve(args['task-dir']);
if (!existsSync(taskDir) || !statSync(taskDir).isDirectory()) {
  abort(header, 'task_dir_missing', `task dir not found: ${taskDir}`);
}

const sourcePath = resolve(args['source-path']);
if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) {
  abort(header, 'source_path_missing', `source path not found: ${sourcePath}`);
}

const phaseFile = resolve(args['phase-file']);
if (!existsSync(phaseFile) || !statSync(phaseFile).isFile()) {
  abort(header, 'phase_file_missing', `phase file not found: ${phaseFile}`);
}

const servicesInPhase = args['services-in-phase'] && args['services-in-phase'] !== true
  ? String(args['services-in-phase'])
  : '1';

const commitType = docsMode ? 'docs' : String(args['commit-type']);
let expectedFiles = splitList(args['changed-files']);

if (docsMode) {
  const tracked = gitLines(sourcePath, ['diff', '--name-only', 'HEAD']);
  const untracked = gitLines(sourcePath, ['ls-files', '--others', '--exclude-standard']);
  if (tracked === null || untracked === null) {
    abort(header, 'not_a_git_repo', `${sourcePath} is not a git working tree`);
  }
  const diffFiles = [...new Set([...tracked, ...untracked])].sort();
  if (diffFiles.length === 0) {
    abort(header, 'no_doc_changes', `phase ${args.phase} declared mode: docs but the working tree has no changes`);
  }
  const nonDoc = diffFiles.filter((file) => !DOC_PATTERNS.some((pattern) => pattern.test(file)));
  if (nonDoc.length > 0) {
    abort(
      [...header, `non_doc_files=${nonDoc.join(',')}`],
      'non_doc_files_in_diff',
      `phase ${args.phase} declared mode: docs but the diff contains code changes: ${nonDoc.join(', ')}`,
      2,
    );
  }
  expectedFiles = diffFiles;
  header.push(`doc_files=${diffFiles.length}`);
}

if (!docsMode) {
  const format = run('bash', [join(binDir, 'format-changed-files.sh')], {
    env: {
      ...process.env,
      FORMAT_SOURCE_PATH: sourcePath,
      FORMAT_CHANGED_FILES: expectedFiles.join('\n'),
      ...(args.conventions && args.conventions !== true ? { FORMAT_CONVENTIONS: args.conventions } : {}),
    },
  });
  const formatOut = parseKeyValues(format.stdout);
  const changedByFormat = Number(formatOut.changed_by_format ?? 0);
  header.push(`format_status=${formatOut.status ?? 'failed'}`);
  if (formatOut.reason) header.push(`format_reason=${formatOut.reason}`);
  header.push(`changed_by_format=${Number.isFinite(changedByFormat) ? changedByFormat : 0}`);

  const recheckCommand = args['green-recheck-command'] && args['green-recheck-command'] !== true
    ? String(args['green-recheck-command'])
    : null;

  if (formatOut.status !== 'ok' || changedByFormat === 0) {
    header.push('green_recheck=skipped');
  } else if (!recheckCommand) {
    header.push('green_recheck=not_requested');
  } else {
    const verdict = classifyCommand(recheckCommand, { cwd: sourcePath, resolveScript: defaultResolveScript });
    if (verdict.decision === 'deny') {
      abort([...header, 'green_recheck=refused'], 'green_recheck_command_denied', verdict.reason, 4);
    }
    const recheckTimeoutMs = Number(process.env.JLU_PHASE_RECHECK_TIMEOUT_MS || 600000);
    const recheck = run('bash', ['-lc', recheckCommand], { cwd: sourcePath, timeout: recheckTimeoutMs });
    if (recheck.error && recheck.error.code === 'ETIMEDOUT') {
      abort([...header, 'green_recheck=timeout'], 'green_recheck_timeout', `Green re-check exceeded ${recheckTimeoutMs} ms: ${recheckCommand}`, 5);
    }
    if (recheck.status !== 0) {
      process.stderr.write(`${tail(`${recheck.stdout}\n${recheck.stderr}`, 50)}\n`);
      abort([...header, 'green_recheck=failed'], 'green_broken_by_format', `Green re-check failed: ${recheckCommand}`, 5);
    }
    header.push('green_recheck=passed');
  }

  const classify = run('bash', [join(binDir, 'classify-phase.sh'), 'all'], {
    env: {
      ...process.env,
      CLASSIFY_PHASE_FILE: phaseFile,
      CLASSIFY_SOURCE_PATH: sourcePath,
      CLASSIFY_SERVICES_IN_PHASE: servicesInPhase,
    },
  });
  const classifyOut = parseKeyValues(classify.stdout);
  header.push(`trivial=${classifyOut.trivial ?? 'false'}`);
  header.push(`trivial_reason=${classifyOut.trivial_reason ?? ''}`);
  if (classifyOut.downgrade_reason) header.push(`downgrade_reason=${classifyOut.downgrade_reason}`);
} else {
  header.push('format_status=skip', 'changed_by_format=0', 'green_recheck=skipped', 'trivial=n/a');
}

const finalize = run('bash', [join(binDir, 'finalize-phase.sh')], {
  env: {
    ...process.env,
    FINALIZE_SOURCE_PATH: sourcePath,
    FINALIZE_TASK_SLUG: String(args['task-slug']),
    FINALIZE_PHASE_NN: String(args.phase),
    FINALIZE_PHASE_TITLE: String(args['phase-title']),
    FINALIZE_SERVICE_ID: String(args.service),
    FINALIZE_COMMIT_TYPE: commitType,
    FINALIZE_EXPECTED: expectedFiles.join('\n'),
  },
});
const finalizeOut = parseKeyValues(finalize.stdout);

let noDiff = false;
if (finalizeOut.status !== 'ok') {
  if (finalizeOut.reason !== 'no_changes') {
    const extra = finalizeOut.unexpected_files ? [`unexpected_files=${finalizeOut.unexpected_files}`] : [];
    process.stderr.write(`${tail(finalize.stderr, 50)}\n`);
    abort([...header, ...extra], finalizeOut.reason || 'commit_failed', `finalize-phase.sh aborted`, 3);
  }
  noDiff = true;
  header.push('commit=(no diff)', 'files_committed=0');
} else {
  header.push(`commit=${finalizeOut.commit_sha}`, `files_committed=${finalizeOut.files_committed ?? ''}`);
}

const stateArgs = [
  join(binDir, 'phase-state.mjs'),
  '--event=end',
  `--task-dir=${taskDir}`,
  `--service=${args.service}`,
  `--phase=${args.phase}`,
  `--phase-file=${phaseFile}`,
  `--phase-title=${args['phase-title']}`,
  `--status=${args.status && args.status !== true ? args.status : 'done'}`,
];
if (args['tests-passed'] != null && args['tests-total'] != null) {
  stateArgs.push(`--tests-passed=${args['tests-passed']}`, `--tests-total=${args['tests-total']}`);
}
if (args.artifacts && args.artifacts !== true) stateArgs.push(`--artifacts=${args.artifacts}`);
if (args.deviations && args.deviations !== true) stateArgs.push(`--deviations=${args.deviations}`);
stateArgs.push(noDiff ? '--no-diff' : `--commit-sha=${finalizeOut.commit_sha}`);
for (const flag of ['span', 'span-status', 'span-success', 'span-attempts']) {
  if (args[flag] && args[flag] !== true) stateArgs.push(`--${flag}=${args[flag]}`);
}

const state = run(process.execPath, stateArgs);
const stateOut = parseKeyValues(state.stdout);
if (state.status !== 0) {
  abort(header, stateOut.reason || 'phase_state_failed', `phase-state.mjs --event=end failed: ${state.stderr}`);
}

emit([
  'status=ok',
  `phase=${args.phase}`,
  `service=${args.service}`,
  ...header,
  `phase_status=${stateOut.phase_status ?? ''}`,
  `completed_at=${stateOut.completed_at ?? ''}`,
  `grammar=${stateOut.grammar ?? ''}`,
  `tasks_md=${stateOut.tasks_md ?? ''}`,
  `phase_file=${stateOut.phase_file ?? ''}`,
  ...(stateOut.span_closed ? [`span_closed=${stateOut.span_closed}`] : []),
]);
