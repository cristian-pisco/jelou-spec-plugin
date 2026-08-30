#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditManifest, inventory } from './lib/dev-link/manifest.mjs';
import { scanShadows, shadowFindings } from './lib/dev-link/shadows.mjs';
import { checkMirrors } from './lib/dev-link/mirrors.mjs';
import { claudeBin, defaultRunner, launchArgv, validateManifest } from './lib/dev-link/claude-cli.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const LIVE_PROMPT =
  'Output ONLY a JSON object and nothing else — no prose, no code fences. ' +
  'Shape: {"skills":[...],"agents":[...]}. ' +
  'skills = every entry in your available-skills list whose name starts with "jlu:", with the "jlu:" prefix stripped. ' +
  'agents = every entry in your available agent types whose name starts with "jlu:", with the "jlu:" prefix stripped.';

export function parseArgs(argv) {
  const opts = { root: REPO_ROOT, json: false, live: false };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    if (arg === '--json') opts.json = true;
    else if (arg === '--live') opts.live = true;
    else if (arg === '--root') opts.root = resolve(rest.shift() ?? '');
    else return { error: `unknown option '${arg}'` };
  }
  return opts;
}

export function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function compareInventory(declared, observed) {
  const findings = [];
  for (const [kind, expected] of Object.entries(declared)) {
    const actual = new Set(observed[kind] ?? []);
    const missing = expected.filter((name) => !actual.has(name));
    const extra = [...actual].filter((name) => !expected.includes(name));
    if (missing.length) {
      findings.push({
        id: `live-${kind}-missing`,
        severity: 'error',
        message: `a session loading this tree cannot see ${missing.length} declared ${kind}: ${missing.join(', ')}`,
        fix: `Check frontmatter and file placement for those ${kind}`,
      });
    }
    if (extra.length) {
      findings.push({
        id: `live-${kind}-extra`,
        severity: 'warn',
        message: `the session sees ${kind} this tree does not declare: ${extra.join(', ')} — another install is still shadowing`,
        fix: 'node bin/dev-link.mjs doctor',
      });
    }
  }
  return findings;
}

export function liveProbe({ root, exec = execFileSync, env = process.env }) {
  let stdout;
  try {
    stdout = exec(claudeBin(env), [...launchArgv(root), '-p', LIVE_PROMPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return { available: false, reason: err.message };
  }
  const observed = extractJsonObject(stdout);
  if (!observed) return { available: false, reason: 'the probe session did not return parseable JSON' };
  const inv = inventory(root);
  return { available: true, findings: compareInventory({ skills: inv.skills, agents: inv.agents }, observed), observed };
}

export function verify({ root, live = false, runner = defaultRunner(), home = process.env.HOME ?? '', exec }) {
  const findings = [...auditManifest(root), ...checkMirrors({ root, exec: exec ?? execFileSync })];
  const validation = validateManifest({ runner, root });
  if (validation.available && !validation.passed) {
    findings.push({ id: 'cli-validate-failed', severity: 'error', message: `claude plugin validate rejected ${root}`, fix: validation.stdout.trim() });
  }
  const advisories = shadowFindings(scanShadows({ root, home })).map((f) => ({ ...f, severity: 'warn' }));
  const probe = live ? liveProbe({ root, exec }) : { available: false, reason: 'not requested' };
  if (probe.available) findings.push(...probe.findings);
  return { findings, advisories, validation, probe };
}

function render(result, out) {
  const { findings, advisories, validation, probe } = result;
  out(`claude plugin validate: ${validation.available ? (validation.passed ? 'passed' : 'FAILED') : `SKIPPED (${validation.reason})`}`);
  if (probe.available) out('live session probe: ran');
  else out(`live session probe: SKIPPED (${probe.reason})`);
  out('');
  const errors = findings.filter((f) => f.severity === 'error');
  if (!errors.length) out('PASS — this working tree loads as a plugin');
  else {
    out(`FAIL — ${errors.length} defect(s) would break the release:`);
    for (const f of errors) out(`  [${f.id}] ${f.message}\n      fix: ${f.fix}`);
  }
  const warnings = [...findings.filter((f) => f.severity === 'warn'), ...advisories];
  if (warnings.length) {
    out('');
    out('advisory (local machine state, not a release blocker):');
    for (const f of warnings) out(`  [${f.id}] ${f.message}`);
  }
  return errors.length ? 1 : 0;
}

export function main(argv, { out = (s) => process.stdout.write(`${s}\n`), runner = defaultRunner(), exec } = {}) {
  const opts = parseArgs(argv);
  if (opts.error) { out(opts.error); return 2; }
  const result = verify({ root: opts.root, live: opts.live, runner, exec });
  if (opts.json) {
    out(JSON.stringify(result, null, 2));
    return result.findings.some((f) => f.severity === 'error') ? 1 : 0;
  }
  return render(result, out);
}

if (process.argv[1] && process.argv[1].endsWith('verify-plugin-load.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
