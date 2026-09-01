import { test, describe, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'bin', 'phase-open.mjs');
const PROMPT_DELIMITER = '----- DISPATCH PROMPT -----';

const created = [];

afterEach(() => {
  while (created.length > 0) rmSync(created.pop(), { recursive: true, force: true });
});

function parseHeader(stdout) {
  const header = stdout.split(PROMPT_DELIMITER)[0];
  const out = {};
  for (const line of header.split('\n')) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function promptBody(stdout) {
  const parts = stdout.split(`${PROMPT_DELIMITER}\n`);
  return parts.length > 1 ? parts[1] : '';
}

function makeTask({ phaseBody, serviceId = 'svc', phaseFileName = '01-seed.md' }) {
  const dir = mkdtempSync(join(tmpdir(), 'phase-open-'));
  created.push(dir);
  const phasesDir = join(dir, 'services', serviceId, 'phases');
  mkdirSync(phasesDir, { recursive: true });
  writeFileSync(join(dir, 'TASKS.md'), '# Task: demo-task\n\n## Phase Progress\n', 'utf8');
  writeFileSync(join(phasesDir, phaseFileName), phaseBody, 'utf8');
  return { dir, phaseFile: join(phasesDir, phaseFileName), serviceId };
}

function runOpen(extraArgs) {
  const result = spawnSync(process.execPath, [SCRIPT, ...extraArgs], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, parsed: parseHeader(result.stdout) };
}

const TDD_PHASE = `# Phase 01: Seed

## Requirements (immutable)
- FR-1 Persist the record
- FR-2 Reject a blank name

## Acceptance (immutable)
- [success] persists and returns 201
- [rejection] blank name returns 422

## Execution (mutable)
### Status: pending
`;

const DOCS_PHASE = `# Phase 01: Docs

**Mode: docs**

## Requirements (immutable)
- FR-1 Document the rollout steps in the README

## Execution (mutable)
### Status: pending
`;

describe('phase-open.mjs — argument validation', () => {
  test('aborts when a required flag is missing', () => {
    const r = runOpen(['--task-dir=/tmp', '--service=svc', '--phase=01']);
    assert.equal(r.code, 1);
    assert.equal(r.parsed.status, 'abort');
    assert.equal(r.parsed.reason, 'missing_argument');
  });

  test('aborts when the task dir does not exist', () => {
    const r = runOpen([
      '--task-dir=/nonexistent-phase-open-xyz',
      '--service=svc',
      '--phase=01',
      '--phase-file=/nonexistent-phase-open-xyz/p.md',
      `--plugin-root=${ROOT}`,
    ]);
    assert.equal(r.code, 1);
    assert.equal(r.parsed.reason, 'task_dir_missing');
  });

  test('aborts when the phase file does not exist', () => {
    const { dir, serviceId } = makeTask({ phaseBody: TDD_PHASE });
    const r = runOpen([
      `--task-dir=${dir}`,
      `--service=${serviceId}`,
      '--phase=09',
      `--phase-file=${join(dir, 'services', serviceId, 'phases', '09-missing.md')}`,
      `--plugin-root=${ROOT}`,
    ]);
    assert.equal(r.code, 1);
    assert.equal(r.parsed.reason, 'phase_file_missing');
  });
});

describe('phase-open.mjs — tdd mode', () => {
  test('writes the phase state and emits the dispatch prompt in one call', () => {
    const { dir, phaseFile, serviceId } = makeTask({ phaseBody: TDD_PHASE });
    const r = runOpen([
      `--task-dir=${dir}`,
      `--service=${serviceId}`,
      '--phase=01',
      `--phase-file=${phaseFile}`,
      '--phase-title=Seed',
      `--plugin-root=${ROOT}`,
      '--services-in-phase=1',
    ]);

    assert.equal(r.code, 0);
    assert.equal(r.parsed.status, 'ok');
    assert.equal(r.parsed.mode, 'tdd');
    assert.equal(r.parsed.fr_nfr_count, '2');
    assert.equal(r.parsed.frontmatter_override, 'none');
    assert.equal(r.parsed.phase_status, 'in_progress');
    assert.equal(r.parsed.prompt, 'below');

    const prompt = promptBody(r.stdout);
    assert.match(prompt, /# DISPATCH: tdd-cycle/);
    assert.match(prompt, /## HARD CONSTRAINTS/);
    assert.match(prompt, /## CASE MATRIX/);

    assert.match(readFileSync(phaseFile, 'utf8'), /### Status: in_progress/);
    assert.match(readFileSync(join(dir, 'TASKS.md'), 'utf8'), /- Status: in_progress/);
  });

  test('never forwards a service docs cache, even when one is handed to it', () => {
    const { dir, phaseFile, serviceId } = makeTask({ phaseBody: TDD_PHASE });
    const docsFile = join(dir, 'service-docs.md');
    writeFileSync(docsFile, '## Conventions\nNaming rule marker AARDVARK.\n', 'utf8');

    const r = runOpen([
      `--task-dir=${dir}`,
      `--service=${serviceId}`,
      '--phase=01',
      `--phase-file=${phaseFile}`,
      `--plugin-root=${ROOT}`,
      `--docs-file=${docsFile}`,
    ]);

    assert.equal(r.code, 0);
    const prompt = promptBody(r.stdout);
    assert.doesNotMatch(prompt, /## SERVICE DOCS/);
    assert.doesNotMatch(prompt, /AARDVARK/);
    assert.doesNotMatch(prompt, /^- CODEBASE_DOCS:/m);
  });

  test('a stale --docs-file pointing at a missing file is inert, not fatal', () => {
    const { dir, phaseFile, serviceId } = makeTask({ phaseBody: TDD_PHASE });

    const r = runOpen([
      `--task-dir=${dir}`,
      `--service=${serviceId}`,
      '--phase=01',
      `--phase-file=${phaseFile}`,
      '--phase-title=Seed',
      `--plugin-root=${ROOT}`,
      '--docs-file=/nonexistent/service-docs.md',
    ]);

    assert.equal(r.code, 0, r.stderr);
    assert.doesNotMatch(promptBody(r.stdout), /## SERVICE DOCS/);
  });

  test('renders a notes file as orchestrator notes', () => {
    const { dir, phaseFile, serviceId } = makeTask({ phaseBody: TDD_PHASE });
    const notesFile = join(dir, 'notes.md');
    writeFileSync(notesFile, 'SERVICE_SOURCE_PATH: /tmp/override-marker\n', 'utf8');

    const r = runOpen([
      `--task-dir=${dir}`,
      `--service=${serviceId}`,
      '--phase=01',
      `--phase-file=${phaseFile}`,
      `--plugin-root=${ROOT}`,
      `--notes-file=${notesFile}`,
    ]);

    assert.equal(r.code, 0);
    assert.match(promptBody(r.stdout), /## ORCHESTRATOR NOTES[\s\S]*override-marker/);
  });
});

describe('phase-open.mjs — docs mode', () => {
  test('classifies docs mode, still opens the phase, and emits no prompt', () => {
    const { dir, phaseFile, serviceId } = makeTask({ phaseBody: DOCS_PHASE });
    const r = runOpen([
      `--task-dir=${dir}`,
      `--service=${serviceId}`,
      '--phase=01',
      `--phase-file=${phaseFile}`,
      `--plugin-root=${ROOT}`,
    ]);

    assert.equal(r.code, 0);
    assert.equal(r.parsed.mode, 'docs');
    assert.equal(r.parsed.prompt, 'none');
    assert.ok(!r.stdout.includes(PROMPT_DELIMITER), 'docs mode must not emit a dispatch prompt');
    assert.match(readFileSync(phaseFile, 'utf8'), /### Status: in_progress/);
  });

  test('a docs override carrying a code-change verb falls back to tdd', () => {
    const body = DOCS_PHASE.replace('Document the rollout steps in the README', 'implement the rollout endpoint');
    const { dir, phaseFile, serviceId } = makeTask({ phaseBody: body });
    const r = runOpen([
      `--task-dir=${dir}`,
      `--service=${serviceId}`,
      '--phase=01',
      `--phase-file=${phaseFile}`,
      `--plugin-root=${ROOT}`,
    ]);

    assert.equal(r.code, 0);
    assert.equal(r.parsed.mode, 'tdd');
    assert.equal(r.parsed.mode_reason, 'docs_override_rejected');
    assert.equal(r.parsed.prompt, 'below');
  });
});

describe('phase-open.mjs — tracing', () => {
  test('emits no span id when the span flags are absent', () => {
    const { dir, phaseFile, serviceId } = makeTask({ phaseBody: TDD_PHASE });
    const r = runOpen([
      `--task-dir=${dir}`,
      `--service=${serviceId}`,
      '--phase=01',
      `--phase-file=${phaseFile}`,
      `--plugin-root=${ROOT}`,
    ]);
    assert.equal(r.code, 0);
    assert.equal(r.parsed.span_id, undefined);
  });

  test('forwards the span flags to phase-state and returns the phase span id', () => {
    const { dir, phaseFile, serviceId } = makeTask({ phaseBody: TDD_PHASE });
    const traceFile = join(dir, 'spans.jsonl');
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        `--task-dir=${dir}`,
        `--service=${serviceId}`,
        '--phase=01',
        `--phase-file=${phaseFile}`,
        `--plugin-root=${ROOT}`,
        '--span-parent=wf-span-1',
        '--span-trace=trace-1',
        '--task-slug=demo-task',
      ],
      { encoding: 'utf8', env: { ...process.env, TRACE_FILE: traceFile } },
    );

    assert.equal(result.status, 0);
    const parsed = parseHeader(result.stdout);
    assert.ok(parsed.span_id && parsed.span_id.length > 0, 'span_id must be returned');
    assert.equal(parsed.trace_id, 'trace-1');
    assert.match(readFileSync(traceFile, 'utf8'), /"name":"phase"/);
  });
});
