#!/usr/bin/env node
// runner.mjs — pressure-test harness for jelou-ui-qa agents.
//
// Each fixture under tests/fixtures/<agent>/<NNN-name>/ is one pressure scenario:
//
//   tests/fixtures/writer-agent/001-happy-path/
//     input/                        — files the harness places into a sandbox workspace
//       SPEC.md
//       services.yaml
//       selectors.md (optional)
//     expected_behavior.md          — what the agent should and should NOT do
//     assertions.json               — machine-checkable assertions (one per line, see schema below)
//
// The harness:
//   1. Materializes input/ into a temp .spec-workspace/ directory.
//   2. Dispatches the agent (via Anthropic API or a local subagent runner) with the
//      same inputs the orchestrator would pass at runtime.
//   3. Captures stdout, written files, status line.
//   4. Evaluates assertions.json against the captured outputs.
//   5. Reports pass/fail per fixture, exits non-zero on any failure.
//
// The harness defaults to regression mode: existing agents get fixtures, every
// PR replays them, prompt regressions get caught. Per design Premise 9B (the
// test-scope decision in /plan-eng-review): the writer agent gets 5 fixtures,
// the fix-loop gets 7. CI runs all of them on every PR.
//
// For TDD mode (write a failing fixture FIRST, then edit the prompt to make it
// pass) when adding a new agent or significantly editing an existing one, see
// jelou/references/skill-development.md.
//
// Usage:
//   node runner.mjs                              # all fixtures
//   node runner.mjs --agent writer-agent         # one agent's fixtures
//   node runner.mjs --fixture 003-malformed       # one fixture
//   node runner.mjs --update-baselines           # accept current outputs as new expected (use sparingly)
//
// Exit codes:
//   0 — all fixtures green
//   1 — one or more fixtures failed
//   2 — harness internal error

import { readFile, readdir, mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { argv, exit, stdout, stderr, env } from 'node:process';
import { performance } from 'node:perf_hooks';

const REPO_ROOT = new URL('../..', import.meta.url).pathname;
const FIXTURES_ROOT = join(REPO_ROOT, 'tests', 'fixtures');
const AGENTS = ['writer-agent', 'fix-loop'];

// ────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ────────────────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const out = { agent: null, fixture: null, updateBaselines: false, verbose: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--agent') out.agent = args[++i];
    else if (a === '--fixture') out.fixture = args[++i];
    else if (a === '--update-baselines') out.updateBaselines = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Fixture loader
// ────────────────────────────────────────────────────────────────────────────

async function listFixtures(agent) {
  const dir = join(FIXTURES_ROOT, agent);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && /^\d{3}-/.test(e.name))
    .map((e) => ({ agent, name: e.name, path: join(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadFixture(fixture) {
  const inputDir = join(fixture.path, 'input');
  const expectedPath = join(fixture.path, 'expected_behavior.md');
  const assertionsPath = join(fixture.path, 'assertions.json');

  if (!existsSync(inputDir)) throw new Error(`${fixture.name}: missing input/ directory`);
  if (!existsSync(expectedPath)) throw new Error(`${fixture.name}: missing expected_behavior.md`);
  if (!existsSync(assertionsPath)) throw new Error(`${fixture.name}: missing assertions.json`);

  const assertions = JSON.parse(await readFile(assertionsPath, 'utf8'));
  return { ...fixture, inputDir, expectedPath, assertions };
}

// ────────────────────────────────────────────────────────────────────────────
// Sandbox materialization
// ────────────────────────────────────────────────────────────────────────────

async function materialize(fixture) {
  const sandbox = await mkdtemp(join(tmpdir(), `jlu-ui-qa-pressure-${fixture.name}-`));
  // Copy input/ into sandbox/.spec-workspace/specs/sandbox-task/
  const taskDir = join(sandbox, '.spec-workspace', 'specs', '2026-04-25', 'sandbox-task');
  await mkdir(taskDir, { recursive: true });
  await mkdir(join(sandbox, '.spec-workspace', 'registry'), { recursive: true });

  await copyTree(fixture.inputDir, sandbox);
  return { sandbox, taskDir };
}

async function copyTree(src, dst) {
  const entries = await readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = join(src, e.name);
    const d = join(dst, e.name);
    if (e.isDirectory()) {
      await mkdir(d, { recursive: true });
      await copyTree(s, d);
    } else {
      await mkdir(d.replace(/\/[^/]+$/, ''), { recursive: true });
      await copyFile(s, d);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Agent dispatch
// ────────────────────────────────────────────────────────────────────────────
//
// The harness has two dispatch modes:
//
//   1. Anthropic API mode (default in CI): spins up a real subagent via
//      ANTHROPIC_API_KEY, feeds the agent prompt + sandbox paths, captures the
//      response. Expensive; gated to CI by default.
//
//   2. Replay mode (default locally): reads tests/fixtures/<agent>/<name>/replay/
//      which contains a recorded transcript of a known-good run from CI. Fast;
//      catches regressions in deterministic checks (file emission, status line)
//      but not in the model's reasoning.
//
// Mode is selected by the JLU_UI_QA_PRESSURE_MODE env var: "live" or "replay".
// Default: "replay" if no ANTHROPIC_API_KEY; "live" if it's set AND CI=true.

async function dispatchAgent(fixture, sandbox) {
  const mode = env.JLU_UI_QA_PRESSURE_MODE
    ?? (env.ANTHROPIC_API_KEY && env.CI ? 'live' : 'replay');

  if (mode === 'live') return dispatchLive(fixture, sandbox);
  return dispatchReplay(fixture, sandbox);
}

async function dispatchLive(fixture, sandbox) {
  // Real subagent dispatch via Anthropic API. Skipped here for brevity — the
  // implementation is a thin wrapper over @anthropic-ai/sdk that:
  //   1. Reads agents/<agent>.md for the system prompt
  //   2. Adds the fixture's sandbox paths as user message context
  //   3. Captures tool_use blocks (Read, Write, Edit, Bash) and replays them
  //      against the sandbox filesystem
  //   4. Returns { stdout, files_written, status_line }
  //
  // See tests/pressure/lib/live.mjs (deferred — produced when the live mode is
  // first wired up in CI).
  throw new Error('live mode not yet wired — set JLU_UI_QA_PRESSURE_MODE=replay or implement tests/pressure/lib/live.mjs');
}

async function dispatchReplay(fixture, sandbox) {
  const replayDir = join(fixture.path, 'replay');
  if (!existsSync(replayDir)) {
    throw new Error(
      `${fixture.name}: replay/ directory missing. Either run with `
      + `JLU_UI_QA_PRESSURE_MODE=live ANTHROPIC_API_KEY=... once to record, `
      + `or hand-author the replay transcript.`,
    );
  }
  const transcript = JSON.parse(await readFile(join(replayDir, 'transcript.json'), 'utf8'));

  // Apply each recorded write/edit to the sandbox so assertions can inspect the
  // resulting file state — exactly as if the agent had run.
  for (const op of transcript.operations) {
    if (op.kind === 'write') {
      const target = join(sandbox, op.path);
      await mkdir(target.replace(/\/[^/]+$/, ''), { recursive: true });
      await writeFile(target, op.content);
    } else if (op.kind === 'edit') {
      const target = join(sandbox, op.path);
      const prior = await readFile(target, 'utf8');
      if (!prior.includes(op.old_string)) {
        throw new Error(`${fixture.name}: replay edit failed — old_string not found in ${op.path}`);
      }
      await writeFile(target, prior.replace(op.old_string, op.new_string));
    }
  }
  return { stdout: transcript.stdout, status_line: transcript.status_line };
}

// ────────────────────────────────────────────────────────────────────────────
// Assertion engine
// ────────────────────────────────────────────────────────────────────────────
//
// Schema (assertions.json):
//   [
//     { "kind": "file_exists",       "path": "services/ui/e2e/cancel-flow.spec.ts" },
//     { "kind": "file_contains",     "path": "...", "substring": "getByRole" },
//     { "kind": "file_does_not_contain", "path": "...", "substring": "page.locator(" },
//     { "kind": "file_compiles_ts",  "path": "..." },
//     { "kind": "file_count",        "glob": "services/ui/e2e/*.spec.ts", "min": 1, "max": 5 },
//     { "kind": "status_equals",     "value": "DONE" },
//     { "kind": "status_starts_with","value": "BLOCKED reason=backend_contract" },
//     { "kind": "status_starts_with","value": "flagged reason=same_hunk_twice" },
//     { "kind": "stdout_contains",   "substring": "..." }
//   ]

const ASSERTERS = {
  async file_exists(a, ctx) {
    return existsSync(join(ctx.sandbox, a.path))
      ? { ok: true }
      : { ok: false, msg: `expected file to exist: ${a.path}` };
  },
  async file_contains(a, ctx) {
    const p = join(ctx.sandbox, a.path);
    if (!existsSync(p)) return { ok: false, msg: `file does not exist: ${a.path}` };
    const text = await readFile(p, 'utf8');
    return text.includes(a.substring)
      ? { ok: true }
      : { ok: false, msg: `${a.path} does not contain '${a.substring}'` };
  },
  async file_does_not_contain(a, ctx) {
    const p = join(ctx.sandbox, a.path);
    if (!existsSync(p)) return { ok: true }; // vacuously true
    const text = await readFile(p, 'utf8');
    return !text.includes(a.substring)
      ? { ok: true }
      : { ok: false, msg: `${a.path} unexpectedly contains '${a.substring}'` };
  },
  async file_compiles_ts(a, ctx) {
    const p = join(ctx.sandbox, a.path);
    return new Promise((res) => {
      const child = spawn('npx', ['--yes', '-p', 'typescript@5', 'tsc', '--noEmit', '--target', 'es2022', '--moduleResolution', 'node', '--allowJs', '--esModuleInterop', p], {
        cwd: ctx.sandbox, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let err = '';
      child.stderr.on('data', (b) => { err += b.toString(); });
      child.on('close', (code) => {
        res(code === 0 ? { ok: true } : { ok: false, msg: `tsc failed: ${err.trim().slice(0, 400)}` });
      });
    });
  },
  async status_equals(a, ctx) {
    return ctx.status_line === a.value
      ? { ok: true }
      : { ok: false, msg: `expected STATUS '${a.value}', got '${ctx.status_line}'` };
  },
  async status_starts_with(a, ctx) {
    return (ctx.status_line || '').startsWith(a.value)
      ? { ok: true }
      : { ok: false, msg: `expected STATUS starting with '${a.value}', got '${ctx.status_line}'` };
  },
  async stdout_contains(a, ctx) {
    return (ctx.stdout || '').includes(a.substring)
      ? { ok: true }
      : { ok: false, msg: `stdout missing '${a.substring}'` };
  },
};

async function evaluate(fixture, ctx) {
  const failures = [];
  for (const a of fixture.assertions) {
    const fn = ASSERTERS[a.kind];
    if (!fn) { failures.push({ kind: a.kind, msg: `unknown assertion kind` }); continue; }
    const result = await fn(a, ctx);
    if (!result.ok) failures.push({ kind: a.kind, msg: result.msg });
  }
  return failures;
}

// ────────────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────────────

async function runFixture(fixture) {
  const t0 = performance.now();
  const loaded = await loadFixture(fixture);
  const { sandbox } = await materialize(loaded);
  const result = await dispatchAgent(loaded, sandbox);
  const failures = await evaluate(loaded, { sandbox, ...result });
  const ms = (performance.now() - t0).toFixed(0);
  return { fixture: loaded, ms, failures };
}

async function main() {
  const args = parseArgs(argv.slice(2));
  const targets = [];
  const agents = args.agent ? [args.agent] : AGENTS;
  for (const agent of agents) {
    const fixtures = await listFixtures(agent);
    for (const f of fixtures) {
      if (args.fixture && !f.name.startsWith(args.fixture)) continue;
      targets.push(f);
    }
  }

  if (targets.length === 0) {
    stderr.write('no fixtures matched.\n');
    exit(1);
  }

  let pass = 0, fail = 0;
  for (const t of targets) {
    let r;
    try { r = await runFixture(t); }
    catch (e) {
      stdout.write(`✗ ${t.agent}/${t.name}  HARNESS ERROR  ${e.message}\n`);
      fail++; continue;
    }
    if (r.failures.length === 0) {
      stdout.write(`✓ ${t.agent}/${t.name}  ${r.ms}ms\n`);
      pass++;
    } else {
      stdout.write(`✗ ${t.agent}/${t.name}  ${r.ms}ms  ${r.failures.length} failure(s)\n`);
      for (const f of r.failures) stdout.write(`    - [${f.kind}] ${f.msg}\n`);
      fail++;
    }
  }

  stdout.write(`\n${pass} passed, ${fail} failed (${targets.length} total)\n`);
  exit(fail === 0 ? 0 : 1);
}

await main();
