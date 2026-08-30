#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditManifest, inventory } from './lib/dev-link/manifest.mjs';
import { isRemovable, removalPlan, scanShadows, shadowFindings } from './lib/dev-link/shadows.mjs';
import { diffAgainstInstalled } from './lib/dev-link/drift.mjs';
import { checkMirrors } from './lib/dev-link/mirrors.mjs';
import {
  PLUGIN_ID,
  defaultRunner,
  installedFindings,
  launchArgv,
  launchCommand,
  claudeBin,
  readInstalledPlugin,
  validateManifest,
} from './lib/dev-link/claude-cli.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const known = new Set(['status', 'doctor', 'clean-shadows', 'launch']);
  const opts = { command: 'status', root: REPO_ROOT, home: process.env.HOME ?? '', json: false, apply: false, includeLegacyRoot: false, printCommand: false, passthrough: [] };
  const rest = [...argv];
  if (rest.length && known.has(rest[0])) opts.command = rest.shift();
  while (rest.length) {
    const arg = rest.shift();
    if (arg === '--') { opts.passthrough = rest.splice(0); break; }
    if (arg === '--json') opts.json = true;
    else if (arg === '--apply') opts.apply = true;
    else if (arg === '--include-legacy-root') opts.includeLegacyRoot = true;
    else if (arg === '--print-command') opts.printCommand = true;
    else if (arg === '--root') opts.root = resolve(rest.shift() ?? '');
    else if (arg === '--home') opts.home = resolve(rest.shift() ?? '');
    else return { error: `unknown option '${arg}'` };
  }
  return opts;
}

export function gitState(root) {
  const run = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  try {
    return { head: run(['rev-parse', '--short', 'HEAD']), branch: run(['rev-parse', '--abbrev-ref', 'HEAD']), dirty: run(['status', '--porcelain']).length > 0 };
  } catch {
    return { head: null, branch: null, dirty: false };
  }
}

export function collectFindings({ root, home, runner }) {
  const installed = readInstalledPlugin({ runner });
  const validation = validateManifest({ runner, root });
  const scan = scanShadows({ root, home });
  const findings = [...auditManifest(root), ...checkMirrors({ root, exec: execFileSync }), ...installedFindings(installed), ...shadowFindings(scan)];
  if (validation.available && !validation.passed) {
    findings.push({ id: 'cli-validate-failed', severity: 'error', message: `claude plugin validate rejected ${root}`, fix: validation.stdout.trim() });
  }
  return { findings, installed, validation, scan };
}

function renderFindings(findings) {
  if (!findings.length) return ['  no findings'];
  return findings.map((f) => `  [${f.severity}] ${f.id}\n      ${f.message}\n      fix: ${f.fix}`);
}

function version(root) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

function commandStatus(opts, runner, out) {
  const installed = readInstalledPlugin({ runner });
  const inv = inventory(opts.root);
  const git = gitState(opts.root);
  const drift = diffAgainstInstalled({ root: opts.root, installPath: installed.installPath });
  const payload = {
    root: opts.root,
    workingTree: { version: version(opts.root), ...git, skills: inv.skills.length, agents: inv.agents.length, hookEvents: inv.hookEvents },
    installed,
    drift,
    launch: launchCommand(opts.root),
  };
  if (opts.json) { out(JSON.stringify(payload, null, 2)); return 0; }

  out(`working tree  ${opts.root}`);
  out(`              v${payload.workingTree.version} @ ${git.branch ?? '?'} ${git.head ?? '?'}${git.dirty ? ' (dirty)' : ''}`);
  out(`              ${inv.skills.length} skills, ${inv.agents.length} agents, hooks: ${inv.hookEvents.join(', ') || 'none'}`);
  if (installed.available && installed.found) {
    out(`installed     ${PLUGIN_ID} v${installed.version}${installed.enabled ? '' : ' (disabled)'}`);
    out(`              ${installed.installPath}`);
    for (const err of installed.errors) out(`              LOAD ERROR: ${err}`);
  } else {
    out(`installed     ${installed.available ? 'not installed' : `unavailable (${installed.reason})`}`);
  }
  if (drift.available) {
    out(`drift         ${drift.total} file(s) differ from the installed release`);
    for (const [surface, d] of Object.entries(drift.bySurface)) {
      out(`              ${surface}: +${d.added.length} -${d.removed.length} ~${d.changed.length}`);
    }
  }
  out('');
  out('test the working tree in a fresh session:');
  out(`  ${payload.launch}`);
  return 0;
}

function commandDoctor(opts, runner, out) {
  const { findings, validation } = collectFindings({ root: opts.root, home: opts.home, runner });
  if (opts.json) { out(JSON.stringify({ findings }, null, 2)); return findings.some((f) => f.severity === 'error') ? 1 : 0; }
  out(`doctor  ${opts.root}`);
  if (validation.available) out(`  claude plugin validate: ${validation.passed ? 'passed' : 'FAILED'}${validation.warnings.length ? ` (${validation.warnings.length} warning(s) the runtime tolerates)` : ''}`);
  else out(`  claude plugin validate: skipped (${validation.reason})`);
  out('');
  for (const line of renderFindings(findings)) out(line);
  return findings.some((f) => f.severity === 'error') ? 1 : 0;
}

function commandCleanShadows(opts, out) {
  const scan = scanShadows({ root: opts.root, home: opts.home });
  const paths = removalPlan(scan, { includeLegacyRoot: opts.includeLegacyRoot });
  const unsafe = paths.filter((p) => !isRemovable(p, opts.home));
  if (unsafe.length) { out(`refusing: ${unsafe.length} path(s) outside the global skills/agents directories`); return 2; }
  if (!paths.length) { out('no shadow copies found'); return 0; }
  if (!opts.apply) {
    out(`${paths.length} shadow copy/copies would be removed (dry run — pass --apply):`);
    for (const p of paths) out(`  ${p}`);
    if (!opts.includeLegacyRoot && scan.legacyRoot) out(`  (${scan.legacyRoot} kept — pass --include-legacy-root to remove it too)`);
    return 1;
  }
  for (const p of paths) rmSync(p, { recursive: true, force: true });
  out(`removed ${paths.length} shadow copy/copies`);
  return 0;
}

function commandLaunch(opts, out) {
  if (opts.printCommand) { out(launchCommand(opts.root, opts.passthrough)); return 0; }
  const args = launchArgv(opts.root, opts.passthrough);
  execFileSync(claudeBin(), args, { stdio: 'inherit' });
  return 0;
}

export function main(argv, { out = (s) => process.stdout.write(`${s}\n`), runner = defaultRunner() } = {}) {
  const opts = parseArgs(argv);
  if (opts.error) { out(opts.error); return 2; }
  if (opts.command === 'status') return commandStatus(opts, runner, out);
  if (opts.command === 'doctor') return commandDoctor(opts, runner, out);
  if (opts.command === 'clean-shadows') return commandCleanShadows(opts, out);
  return commandLaunch(opts, out);
}

if (process.argv[1] && process.argv[1].endsWith('dev-link.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
