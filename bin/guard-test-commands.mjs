#!/usr/bin/env node
// PreToolUse guard for Bash commands (wired via hooks/hooks.json).
//
// Uncapped test runs spawn one worker per CPU core and have frozen dev
// machines hard enough to need a forced power-off. Prompts already forbid
// this (subagent-base.md "Test Execution Resource Limits"); this guard makes
// the policy deterministic: it denies the dangerous invocation and tells the
// agent the corrected form, so the next attempt self-corrects.
//
// Stdin: PreToolUse JSON ({ tool_input: { command }, cwd }).
// Stdout: permissionDecision JSON on deny; nothing on allow.
// Escape hatch for humans (never suggest it to agents): JLU_TEST_GUARD=off.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const POLICY = 'subagent-base.md "Test Execution Resource Limits"';
const RUNNERS = new Set(['jest', 'vitest', 'playwright', 'mocha', 'pytest', 'tsc', 'nx']);
const WRAPPERS = new Set(['nice', 'ionice', 'time', 'env', 'cross-env', 'dotenv', 'npx', 'bunx', 'xvfb-run']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const MAX_SCRIPT_DEPTH = 3;

const allow = () => ({ decision: 'allow' });
const deny = (reason) => ({ decision: 'deny', reason: `jlu resource guard: ${reason}` });

function tokenize(segment) {
  return segment.trim().split(/\s+/).filter(Boolean);
}

function baseName(token) {
  return token.replace(/^['"]|['"]$/g, '').split('/').pop();
}

// Quote-aware: `jest -t "a && b" --maxWorkers=2` must stay one segment.
function splitSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote && command[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === ';' || ch === '|' || (ch === '&' && command[i + 1] === '&')) {
      if (ch === '&') i += 1;
      if (ch === '|' && command[i + 1] === '|') i += 1;
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments.map((s) => s.replace(/^[\s(]+/, '').trim()).filter(Boolean);
}

function findEffectiveCommand(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) { i += 1; continue; }
    const base = baseName(token);
    if (WRAPPERS.has(base)) {
      i += 1;
      if (base === 'dotenv') {
        while (i < tokens.length && tokens[i] !== '--') i += 1;
        i += 1;
      } else if (base === 'nice' || base === 'ionice') {
        while (i < tokens.length && (/^-/.test(tokens[i]) || /^\d+$/.test(tokens[i]))) i += 1;
      }
      continue;
    }
    if (PACKAGE_MANAGERS.has(base)) return { kind: 'pm', pm: base, rest: tokens.slice(i + 1) };
    if (base === 'node') {
      const rest = tokens.slice(i + 1);
      if (rest.includes('--test')) return { kind: 'runner', runner: 'node-test', rest };
      const target = rest.find((t) => !t.startsWith('-'));
      const targetBase = target ? baseName(target) : '';
      if (RUNNERS.has(targetBase)) return { kind: 'runner', runner: targetBase, rest };
      return { kind: 'other' };
    }
    if (RUNNERS.has(base)) return { kind: 'runner', runner: base, rest: tokens.slice(i + 1) };
    return { kind: 'other', first: base };
  }
  return { kind: 'other' };
}

function flagValue(tokens, name) {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === name) return tokens[i + 1];
    if (tokens[i].startsWith(`${name}=`)) return tokens[i].slice(name.length + 1);
  }
  return undefined;
}

function hasToken(tokens, pattern) {
  return tokens.some((t) => pattern.test(t));
}

function jestCapOk(tokens) {
  if (hasToken(tokens, /^(--runInBand|-i)$/)) return true;
  const value = flagValue(tokens, '--maxWorkers');
  return /^[12]$/.test(value ?? '');
}

function classifyRunner(runner, tokens) {
  if (hasToken(tokens, /^(--watch|--watchAll)(=.*)?$/)) {
    return deny(`watch mode never exits and holds test workers resident. Drop the watch flag and run a single pass with a worker cap (${POLICY}).`);
  }
  if (hasToken(tokens, /^(--coverage|--cov)(=.*)?$/)) {
    return deny(`coverage instrumentation multiplies RAM and is forbidden in the TDD pipeline. Remove the coverage flag; coverage is read statically from existing reports (${POLICY}).`);
  }

  switch (runner) {
    case 'jest':
    case 'nx':
      if (jestCapOk(tokens)) return allow();
      return deny(`uncapped ${runner} spawns one worker per CPU core and has frozen this machine. Append \`--maxWorkers=2\` (single file: \`--runInBand\`), e.g. \`npx jest <file.spec.ts> --maxWorkers=2\` (${POLICY}).`);
    case 'vitest': {
      const singlePass = tokens.includes('run') || tokens.includes('--run');
      if (!singlePass) {
        return deny(`bare \`vitest\` starts watch mode and never exits. Use \`vitest run <files> --pool=threads --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=2\` (${POLICY}).`);
      }
      const capped = hasToken(tokens, /maxThreads=|maxForks=/) ||
        /^[12]$/.test(flagValue(tokens, '--maxWorkers') ?? '') ||
        tokens.includes('--no-file-parallelism');
      if (capped) return allow();
      return deny(`uncapped vitest spawns one thread per CPU core. Append \`--pool=threads --poolOptions.threads.minThreads=1 --poolOptions.threads.maxThreads=2\` (${POLICY}).`);
    }
    case 'playwright': {
      if (tokens[0] !== 'test') return allow();
      const workers = flagValue(tokens, '--workers');
      if (/^[1-4]$/.test(workers ?? '')) return allow();
      return deny(`playwright defaults to one worker per 2 CPU cores, each booting its own Chromium. Append \`--workers=1\` (${POLICY}).`);
    }
    case 'pytest': {
      const n = flagValue(tokens, '-n') ?? flagValue(tokens, '--numprocesses');
      if (n !== undefined && !/^[12]$/.test(n)) {
        return deny(`pytest-xdist with \`-n ${n}\` fans out beyond the 2-worker cap. Use \`-n 2\` or drop the flag (${POLICY}).`);
      }
      return allow();
    }
    case 'tsc':
      if (hasToken(tokens, /^(-w|--watch)$/)) {
        return deny(`\`tsc --watch\` never exits and holds the compiler resident. Run a single \`tsc --noEmit\` pass instead (${POLICY}).`);
      }
      return allow();
    case 'mocha':
    case 'node-test':
      return allow();
    default:
      return allow();
  }
}

function analyzeScript(scriptContent, ctx, depth) {
  if (depth > MAX_SCRIPT_DEPTH) return { kind: 'unknown' };
  let worst = { kind: 'safe' };
  for (const segment of splitSegments(scriptContent)) {
    const tokens = tokenize(segment);
    const effective = findEffectiveCommand(tokens);
    if (effective.kind === 'runner') {
      const verdict = classifyRunner(effective.runner, effective.rest);
      if (verdict.decision === 'deny') {
        if (/watch mode|never exits|coverage/.test(verdict.reason)) return { kind: 'forbidden', reason: verdict.reason };
        worst = { kind: 'needs-cap', runner: effective.runner };
      }
    } else if (effective.kind === 'pm') {
      const nested = classifyPackageManager(effective.pm, effective.rest, ctx, depth + 1);
      if (nested.decision === 'deny') worst = { kind: 'needs-cap', runner: 'jest' };
    }
  }
  return worst;
}

function forwardedTokens(pm, rest) {
  if (pm !== 'npm') return rest;
  const separator = rest.indexOf('--');
  return separator === -1 ? [] : rest.slice(separator + 1);
}

function classifyPackageManager(pm, rest, ctx, depth) {
  let j = 0;
  if (rest[j] === 'run' || rest[j] === 'run-script') j += 1;
  else if (['exec', 'dlx', 'x'].includes(rest[j])) {
    const target = rest[j + 1];
    const targetBase = target ? baseName(target) : '';
    if (RUNNERS.has(targetBase)) return classifyRunner(targetBase, rest.slice(j + 2));
    return allow();
  }

  const script = rest[j];
  if (!script) return allow();
  if (RUNNERS.has(baseName(script))) return classifyRunner(baseName(script), rest.slice(j + 1));
  if (!/^tests?(:[\w-]+)?$/.test(script) && !/^coverage$/.test(script)) return allow();

  if (/(:watch)$/.test(script)) {
    return deny(`\`${pm} ${rest.slice(0, j + 1).join(' ')}\` is a watch-mode script — it never exits. Run a single pass with explicit files and a worker cap (${POLICY}).`);
  }
  if (/(:cov|:coverage)$|^coverage$/.test(script)) {
    return deny(`coverage scripts re-execute the suite with instrumentation and are forbidden in the TDD pipeline (${POLICY}).`);
  }

  const scriptContent = ctx.resolveScript(ctx.dir, script);
  if (scriptContent === null) {
    return deny(`could not resolve what \`${pm} ${script}\` runs, so it cannot be verified as worker-capped. Invoke the runner directly with explicit files, e.g. \`npx jest <file.spec.ts> --maxWorkers=2\` (${POLICY}).`);
  }

  const analysis = analyzeScript(scriptContent, ctx, depth);
  if (analysis.kind === 'safe') return allow();
  if (analysis.kind === 'forbidden') return deny(analysis.reason);

  const forwarded = forwardedTokens(pm, rest.slice(j + 1));
  const verdict = classifyRunner(analysis.runner ?? 'jest', forwarded);
  if (verdict.decision === 'allow' && forwarded.length > 0) return allow();

  const example = pm === 'npm'
    ? `npm ${script === 'test' ? 'test' : `run ${script}`} -- <file.spec.ts> --maxWorkers=2`
    : `${pm} ${script} <file.spec.ts> --maxWorkers=2`;
  return deny(`\`${pm} ${script}\` resolves to an uncapped test runner — the full suite at one worker per CPU core has frozen this machine (npm also swallows flags passed without \`--\`, e.g. \`npm test --no-coverage\` runs the bare full suite). Run only the files you need with a worker cap: \`${example}\` or \`npx jest <files> --maxWorkers=2\` (${POLICY}).`);
}

export function classifyCommand(command, ctx) {
  if (!/test|jest|vitest|playwright|pytest|tsc|mocha|nx /.test(command)) return allow();

  let dir = ctx.cwd;
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;

    if (baseName(tokens[0]) === 'cd' && tokens[1]) {
      dir = resolve(dir, tokens[1].replace(/^['"]|['"]$/g, ''));
      continue;
    }

    const effective = findEffectiveCommand(tokens);
    let verdict = allow();
    if (effective.kind === 'runner') verdict = classifyRunner(effective.runner, effective.rest);
    else if (effective.kind === 'pm') {
      verdict = classifyPackageManager(effective.pm, effective.rest, { ...ctx, dir }, 0);
    }
    if (verdict.decision === 'deny') return verdict;
  }
  return allow();
}

export function defaultResolveScript(dir, scriptName) {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return manifest.scripts?.[scriptName] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  if (process.env.JLU_TEST_GUARD === 'off') return;

  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    return;
  }

  const command = payload?.tool_input?.command;
  if (typeof command !== 'string' || command.length === 0) return;

  const cwd = payload?.cwd || process.cwd();
  const verdict = classifyCommand(command, { cwd, resolveScript: defaultResolveScript });
  if (verdict.decision === 'deny') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: verdict.reason,
      },
    }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
