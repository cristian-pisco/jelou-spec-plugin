import { test, describe, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'bin', 'phase-close.mjs');
const TASK_SLUG = 'demo-task';

const created = [];

afterEach(() => {
  while (created.length > 0) rmSync(created.pop(), { recursive: true, force: true });
});

function parseOutput(stdout) {
  const out = {};
  for (const line of String(stdout).split('\n')) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

const PHASE_BODY = `# Phase 01: Seed

## Requirements (immutable)
- FR-1 Persist the record

## Execution (mutable)
### Status: in_progress
`;

const FORMAT_SCRIPT = 'node -e "for (const f of process.argv.slice(1)) if (f.endsWith(\'.ts\')) require(\'fs\').writeFileSync(f, \'formatted\\n\')"';
const RED_RECHECK_COMMAND = 'node -e "process.exit(1)"';

function writeFormattingProject(repo) {
  writeFileSync(join(repo, 'package.json'), JSON.stringify({
    name: 'fx',
    scripts: { format: FORMAT_SCRIPT },
  }, null, 2));
  writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
}

function makeFixture({ phaseBody = PHASE_BODY, branch = `production/${TASK_SLUG}` } = {}) {
  const taskDir = mkdtempSync(join(tmpdir(), 'phase-close-task-'));
  created.push(taskDir);
  const phasesDir = join(taskDir, 'services', 'svc', 'phases');
  mkdirSync(phasesDir, { recursive: true });
  writeFileSync(join(taskDir, 'TASKS.md'), '# Task: demo-task\n\n## Phase Progress\n', 'utf8');
  const phaseFile = join(phasesDir, '01-seed.md');
  writeFileSync(phaseFile, phaseBody, 'utf8');

  const repo = mkdtempSync(join(tmpdir(), 'phase-close-repo-'));
  created.push(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'checkout', '-q', '-b', branch);
  writeFileSync(join(repo, 'baseline.txt'), 'baseline\n');
  git(repo, 'add', 'baseline.txt');
  git(repo, 'commit', '-q', '-m', 'baseline');

  return { taskDir, phaseFile, repo };
}

function runClose(extraArgs, env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, parsed: parseOutput(result.stdout) };
}

function baseArgs({ taskDir, phaseFile, repo }) {
  return [
    `--task-dir=${taskDir}`,
    '--service=svc',
    '--phase=01',
    `--phase-file=${phaseFile}`,
    '--phase-title=Seed',
    `--source-path=${repo}`,
    `--task-slug=${TASK_SLUG}`,
  ];
}

describe('phase-close.mjs — argument validation', () => {
  test('aborts when --changed-files is missing outside docs mode', () => {
    const fx = makeFixture();
    const r = runClose([...baseArgs(fx), '--commit-type=feat']);
    assert.equal(r.code, 1);
    assert.equal(r.parsed.status, 'abort');
    assert.equal(r.parsed.reason, 'missing_argument');
  });

  test('aborts when the source path does not exist', () => {
    const fx = makeFixture();
    const r = runClose([
      `--task-dir=${fx.taskDir}`,
      '--service=svc',
      '--phase=01',
      `--phase-file=${fx.phaseFile}`,
      '--phase-title=Seed',
      '--source-path=/nonexistent-phase-close-xyz',
      `--task-slug=${TASK_SLUG}`,
      '--commit-type=feat',
      '--changed-files=a.ts',
    ]);
    assert.equal(r.code, 1);
    assert.equal(r.parsed.reason, 'source_path_missing');
  });
});

describe('phase-close.mjs — happy path', () => {
  test('formats, classifies triviality, commits, and writes the end state in one call', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.repo, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(fx.repo, 'a.test.ts'), 'test("a", () => {});\n');

    const r = runClose([
      ...baseArgs(fx),
      '--commit-type=feat',
      '--changed-files=a.ts,a.test.ts',
      '--tests-passed=2',
      '--tests-total=2',
      '--artifacts=a.ts,a.test.ts',
    ]);

    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed.status, 'ok');
    assert.equal(r.parsed.format_status, 'skip');
    assert.equal(r.parsed.green_recheck, 'skipped');
    assert.equal(r.parsed.trivial, 'true');
    assert.equal(r.parsed.phase_status, 'done');
    assert.ok(/^[0-9a-f]{7,}$/.test(r.parsed.commit), `expected a commit sha, got ${r.parsed.commit}`);

    assert.match(readFileSync(fx.phaseFile, 'utf8'), /### Status: done/);
    const tasks = readFileSync(join(fx.taskDir, 'TASKS.md'), 'utf8');
    assert.match(tasks, /- Status: done/);
    assert.match(tasks, /- Tests: 2\/2 passing/);
    assert.match(tasks, new RegExp(`- Commit: ${r.parsed.commit}`));
    assert.equal(git(fx.repo, 'status', '--porcelain').trim(), '');
  });

  test('a large diff classifies non-trivial', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.repo, 'baseline.txt'), Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n'));
    const r = runClose([...baseArgs(fx), '--commit-type=feat', '--changed-files=baseline.txt']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed.trivial, 'false');
  });
});

describe('phase-close.mjs — finalize abort routing', () => {
  test('no_changes becomes a no-diff phase completion, not a failure', () => {
    const fx = makeFixture();
    const r = runClose([...baseArgs(fx), '--commit-type=feat', '--changed-files=a.ts']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed.commit, '(no diff)');
    assert.equal(r.parsed.phase_status, 'done');
    assert.match(readFileSync(join(fx.taskDir, 'TASKS.md'), 'utf8'), /- Commit: \(no diff\)/);
  });

  test('an out-of-scope file aborts before any state write', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.repo, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(fx.repo, 'stray.ts'), 'export const stray = 1;\n');

    const r = runClose([...baseArgs(fx), '--commit-type=feat', '--changed-files=a.ts']);
    assert.notEqual(r.code, 0);
    assert.equal(r.parsed.status, 'abort');
    assert.equal(r.parsed.reason, 'unexpected_files_in_diff');
    assert.equal(r.parsed.unexpected_files, 'stray.ts');
    assert.match(readFileSync(fx.phaseFile, 'utf8'), /### Status: in_progress/);
  });

  test('the wrong branch aborts the phase', () => {
    const fx = makeFixture({ branch: 'main' });
    writeFileSync(join(fx.repo, 'a.ts'), 'export const a = 1;\n');
    const r = runClose([...baseArgs(fx), '--commit-type=feat', '--changed-files=a.ts']);
    assert.notEqual(r.code, 0);
    assert.equal(r.parsed.reason, 'wrong_branch');
  });
});

describe('phase-close.mjs — docs mode', () => {
  test('derives its own scope from the diff and commits documentation only', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.repo, 'README.md'), '# readme\n');
    mkdirSync(join(fx.repo, 'docs'), { recursive: true });
    writeFileSync(join(fx.repo, 'docs', 'guide.md'), '# guide\n');

    const r = runClose([...baseArgs(fx), '--docs']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed.doc_files, '2');
    assert.equal(r.parsed.trivial, 'n/a');
    assert.ok(/^[0-9a-f]{7,}$/.test(r.parsed.commit));
    assert.match(git(fx.repo, 'log', '-1', '--pretty=%s'), /^docs\(svc\): Seed/);
  });

  test('a code file in a docs-mode diff aborts', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.repo, 'README.md'), '# readme\n');
    writeFileSync(join(fx.repo, 'handler.ts'), 'export const h = 1;\n');

    const r = runClose([...baseArgs(fx), '--docs']);
    assert.equal(r.code, 2);
    assert.equal(r.parsed.reason, 'non_doc_files_in_diff');
    assert.equal(r.parsed.non_doc_files, 'handler.ts');
  });

  test('an empty docs diff aborts', () => {
    const fx = makeFixture();
    const r = runClose([...baseArgs(fx), '--docs']);
    assert.equal(r.code, 1);
    assert.equal(r.parsed.reason, 'no_doc_changes');
  });
});

describe('phase-close.mjs — Green re-check gate', () => {
  test('refuses a re-check command the resource guard denies', () => {
    const fx = makeFixture();
    writeFormattingProject(fx.repo);

    const r = runClose([
      ...baseArgs(fx),
      '--commit-type=feat',
      '--changed-files=a.ts,package.json',
      '--green-recheck-command=npx jest',
    ]);

    assert.equal(r.parsed.changed_by_format, '1');
    assert.equal(r.code, 4);
    assert.equal(r.parsed.green_recheck, 'refused');
    assert.equal(r.parsed.reason, 'green_recheck_command_denied');
  });

  test('a red re-check after formatting aborts before the commit', () => {
    const fx = makeFixture();
    writeFormattingProject(fx.repo);

    const r = runClose([
      ...baseArgs(fx),
      '--commit-type=feat',
      '--changed-files=a.ts,package.json',
      `--green-recheck-command=${RED_RECHECK_COMMAND}`,
    ]);

    assert.equal(r.code, 5);
    assert.equal(r.parsed.green_recheck, 'failed');
    assert.equal(r.parsed.reason, 'green_broken_by_format');
    assert.equal(git(fx.repo, 'log', '-1', '--pretty=%s').trim(), 'baseline');
  });

  test('changed_by_format=0 skips the re-check without running it', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.repo, 'a.ts'), 'export const a = 1;\n');
    const r = runClose([
      ...baseArgs(fx),
      '--commit-type=feat',
      '--changed-files=a.ts',
      '--green-recheck-command=exit 1',
    ]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed.changed_by_format, '0');
    assert.equal(r.parsed.green_recheck, 'skipped');
  });
});

describe('phase-close.mjs — tracing', () => {
  test('closes the phase span when the span flags are passed', () => {
    const fx = makeFixture();
    const traceFile = join(fx.taskDir, 'spans.jsonl');
    const open = spawnSync(process.execPath, [
      join(ROOT, 'bin', 'phase-state.mjs'),
      '--event=start',
      `--task-dir=${fx.taskDir}`,
      '--service=svc',
      '--phase=01',
      `--phase-file=${fx.phaseFile}`,
      '--span-parent=wf-1',
      '--span-trace=trace-1',
      '--task-slug=demo-task',
    ], { encoding: 'utf8', env: { ...process.env, TRACE_FILE: traceFile } });
    const spanId = parseOutput(open.stdout).span_id;
    assert.ok(spanId);

    writeFileSync(join(fx.repo, 'a.ts'), 'export const a = 1;\n');
    const r = runClose([
      ...baseArgs(fx),
      '--commit-type=feat',
      '--changed-files=a.ts',
      `--span=${spanId}`,
      '--span-status=ok',
      '--span-success=pass@1',
      '--span-attempts=1',
    ], { TRACE_FILE: traceFile });

    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed.span_closed, 'true');
    const spans = readFileSync(traceFile, 'utf8');
    assert.match(spans, /"event_kind":"span_end"/);
    assert.match(spans, /pass@1/);
  });

  test('emits no span close when the span flags are absent', () => {
    const fx = makeFixture();
    const traceFile = join(fx.taskDir, 'spans.jsonl');
    writeFileSync(join(fx.repo, 'a.ts'), 'export const a = 1;\n');
    const r = runClose([...baseArgs(fx), '--commit-type=feat', '--changed-files=a.ts'], { TRACE_FILE: traceFile });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.parsed.span_closed, undefined);
  });
});
