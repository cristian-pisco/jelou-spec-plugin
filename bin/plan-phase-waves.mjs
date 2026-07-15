#!/usr/bin/env node
// plan-phase-waves.mjs — deterministic wave planning for execute-task Step 7.0.
//
// Given a task directory and an execution strategy, emit a JSON plan describing
// the wave-by-wave execution order. The orchestrator calls this once at the
// start of Step 7 and iterates `result.waves`.
//
// Inputs (env vars or CLI args; CLI takes precedence):
//   --task-dir=<path>           Absolute path to .spec-workspace/specs/<date>/<task>/
//   --strategy=<seq|psp>        sequential | per-service-parallel (default: sequential)
//   --phase-parallelism=<N>     Concurrency cap (default: 1)
//
// Output (stdout, single JSON object):
//   {
//     "strategy": "sequential" | "per-service-parallel",
//     "phase_parallelism": <N>,
//     "lanes": { "<service-id>": [{ "phase": "01", "phase_file": "..." }, ...] },
//     "waves": [
//       [{ "service": "...", "phase": "...", "phase_file": "..." }, ...],
//       ...
//     ],
//     "summary": "<human-readable one-line summary>"
//   }
//
// Exit codes:
//   0 — plan emitted
//   1 — input validation error (missing task dir, bad strategy)
//   2 — task dir has no phase files
//   3 — invalid **Needs:** graph (cycle or reference to a non-existent phase)

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z-]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function die(msg, code = 1) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(code);
}

function parseNeeds(content) {
  const m = content.match(/^\*\*Needs:\*\*[ \t]*(.*?)[ \t]*$/m);
  if (m === null) return null;
  const raw = m[1].trim();
  if (raw === '') return null;
  if (raw.toLowerCase() === 'none') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function computeLevels(serviceId, items) {
  const byPhase = new Map(items.map((it) => [it.phase, it]));
  for (const it of items) {
    for (const need of it.needs) {
      if (!byPhase.has(need)) {
        die(`service '${serviceId}': phase '${it.phase}' needs '${need}' which is not a phase in this service`, 3);
      }
    }
  }
  const level = new Map();
  const resolveLevel = (phase, stack) => {
    if (level.has(phase)) return level.get(phase);
    if (stack.has(phase)) {
      die(`service '${serviceId}': dependency cycle involving phase '${phase}'`, 3);
    }
    stack.add(phase);
    let lvl = 0;
    for (const need of byPhase.get(phase).needs) {
      lvl = Math.max(lvl, resolveLevel(need, stack) + 1);
    }
    stack.delete(phase);
    level.set(phase, lvl);
    return lvl;
  };
  for (const it of items) resolveLevel(it.phase, new Set());
  const maxLvl = items.reduce((mx, it) => Math.max(mx, level.get(it.phase)), 0);
  const levels = [];
  for (let l = 0; l <= maxLvl; l++) {
    levels.push(items.filter((it) => level.get(it.phase) === l));
  }
  return levels;
}

const args = parseArgs(process.argv);
const taskDir = args['task-dir'] || process.env.PLAN_TASK_DIR;
const strategyInput = (args['strategy'] || process.env.PLAN_STRATEGY || 'sequential').toLowerCase();
const phaseParallelism = parseInt(args['phase-parallelism'] || process.env.PLAN_PHASE_PARALLELISM || '1', 10);

if (!taskDir) die('--task-dir or PLAN_TASK_DIR required');
if (!existsSync(taskDir) || !statSync(taskDir).isDirectory()) {
  die(`task dir not found or not a directory: ${taskDir}`);
}

const STRATEGY_MAP = {
  sequential: 'sequential',
  seq: 'sequential',
  'per-service-parallel': 'per-service-parallel',
  psp: 'per-service-parallel',
};
const strategy = STRATEGY_MAP[strategyInput];
if (!strategy) {
  die(`unknown strategy: ${strategyInput} (expected: sequential | per-service-parallel)`);
}

if (!Number.isInteger(phaseParallelism) || phaseParallelism < 1) {
  die(`--phase-parallelism must be a positive integer (got: ${phaseParallelism})`);
}

// ----- Discover phase files --------------------------------------------

const servicesDir = join(taskDir, 'services');
if (!existsSync(servicesDir)) die(`no services/ directory in ${taskDir}`, 2);

const lanes = {};
for (const serviceId of readdirSync(servicesDir).sort()) {
  const phasesDir = join(servicesDir, serviceId, 'phases');
  if (!existsSync(phasesDir) || !statSync(phasesDir).isDirectory()) continue;

  const phaseFiles = readdirSync(phasesDir)
    .filter(f => f.endsWith('.md'))
    .sort();
  if (phaseFiles.length === 0) continue;

  lanes[serviceId] = phaseFiles.map(filename => {
    // Strip extension, then parse leading NN-... prefix as the phase id.
    const stem = filename.replace(/\.md$/, '');
    const m = stem.match(/^(\d+[a-z]?)-/);
    const phase = m ? m[1] : stem;
    return {
      phase,
      phase_file: resolve(phasesDir, filename),
    };
  });
}

const totalPhases = Object.values(lanes).reduce((acc, lane) => acc + lane.length, 0);
if (totalPhases === 0) die(`no phase files found under ${servicesDir}`, 2);

for (const serviceId of Object.keys(lanes)) {
  const items = lanes[serviceId];
  items.forEach((item, idx) => {
    const declared = parseNeeds(readFileSync(item.phase_file, 'utf8'));
    item.needs = declared === null ? (idx === 0 ? [] : [items[idx - 1].phase]) : declared;
  });
}

const laneLevels = {};
for (const serviceId of Object.keys(lanes)) {
  laneLevels[serviceId] = computeLevels(serviceId, lanes[serviceId]);
}

// ----- Build waves -----------------------------------------------------

const toWaveItem = (serviceId, it) => ({ service: serviceId, phase: it.phase, phase_file: it.phase_file });
const services = Object.keys(lanes).sort();

let waves;
if (strategy === 'sequential') {
  waves = [];
  for (const serviceId of services) {
    for (const lvl of laneLevels[serviceId]) {
      waves.push(lvl.map((it) => toWaveItem(serviceId, it)));
    }
  }
} else {
  const maxLevels = Math.max(...services.map((s) => laneLevels[s].length));
  waves = [];
  for (let k = 0; k < maxLevels; k++) {
    const wave = [];
    for (const svc of services) {
      const lvl = laneLevels[svc][k];
      if (lvl) for (const it of lvl) wave.push(toWaveItem(svc, it));
    }
    waves.push(wave);
  }
}

const chunked = [];
for (const wave of waves) {
  if (wave.length <= phaseParallelism) {
    chunked.push(wave);
  } else {
    for (let i = 0; i < wave.length; i += phaseParallelism) {
      chunked.push(wave.slice(i, i + phaseParallelism));
    }
  }
}
waves = chunked;

let summary;
if (strategy === 'sequential') {
  summary = `Sequential: ${totalPhases} phases, ${services.length} service(s), PHASE_PARALLELISM=${phaseParallelism}.`;
} else {
  const maxLane = Math.max(...services.map((s) => lanes[s].length));
  summary = `Per-service parallel: ${totalPhases} phases across ${services.length} service lane(s) (max ${maxLane} phases), ${waves.length} wave(s), PHASE_PARALLELISM=${phaseParallelism}.`;
}

// ----- Emit JSON -------------------------------------------------------

process.stdout.write(JSON.stringify({
  strategy,
  phase_parallelism: phaseParallelism,
  lanes,
  waves,
  summary,
}, null, 2) + '\n');
