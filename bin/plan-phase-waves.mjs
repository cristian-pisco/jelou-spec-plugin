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

import { readdirSync, statSync, existsSync } from 'node:fs';
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

// ----- Build waves -----------------------------------------------------

let waves;
let summary;

if (strategy === 'sequential') {
  // One phase per wave, in lexicographic order: service-id, then phase prefix.
  const flat = [];
  for (const serviceId of Object.keys(lanes).sort()) {
    for (const item of lanes[serviceId]) {
      flat.push({ service: serviceId, phase: item.phase, phase_file: item.phase_file });
    }
  }
  waves = flat.map(p => [p]);
  summary = `Sequential: ${totalPhases} phases, ${Object.keys(lanes).length} service(s), PHASE_PARALLELISM=${phaseParallelism}.`;
} else {
  // per-service-parallel: zip lanes by index, then chunk by PHASE_PARALLELISM.
  const services = Object.keys(lanes).sort();
  const maxLane = Math.max(...services.map(s => lanes[s].length));
  const naiveWaves = [];
  for (let i = 0; i < maxLane; i++) {
    const wave = [];
    for (const svc of services) {
      const item = lanes[svc][i];
      if (item) wave.push({ service: svc, phase: item.phase, phase_file: item.phase_file });
    }
    naiveWaves.push(wave);
  }

  // Chunk each naive wave by PHASE_PARALLELISM cap.
  waves = [];
  for (const wave of naiveWaves) {
    if (wave.length <= phaseParallelism) {
      waves.push(wave);
    } else {
      for (let i = 0; i < wave.length; i += phaseParallelism) {
        waves.push(wave.slice(i, i + phaseParallelism));
      }
    }
  }

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
