#!/usr/bin/env node
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { availableParallelism } from 'node:os';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function die(msg, code = 1) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(code);
}

function envCapCeiling(env) {
  const ceilings = [];
  for (const name of ['JLU_PHASE_PARALLELISM', 'PLAN_PHASE_PARALLELISM']) {
    const parsed = parseInt(env[name] ?? '', 10);
    if (Number.isInteger(parsed) && parsed >= 1) ceilings.push(parsed);
  }
  return ceilings.length > 0 ? Math.min(...ceilings) : null;
}

function machineAutoCap(limit) {
  return Math.min(Math.max(Math.floor(availableParallelism() / 4), 1), limit);
}

function applyEnvCeiling(cap, env) {
  const ceiling = envCapCeiling(env);
  return ceiling === null ? cap : Math.min(cap, ceiling);
}

function resolveCap(limit, env) {
  return applyEnvCeiling(machineAutoCap(limit), env);
}

function phaseIdOf(value) {
  const stem = value.replace(/\.md$/, '');
  const m = stem.match(/^(\d+[a-z]?)-/);
  return m ? m[1] : stem;
}

function parseNeeds(content) {
  const m = content.match(/^\*\*Needs:\*\*[ \t]*(.*?)[ \t]*$/m);
  if (m === null) return null;
  const raw = m[1].trim();
  if (raw === '') return null;
  if (raw.toLowerCase() === 'none') return [];
  return raw.split(',').map((s) => phaseIdOf(s.trim())).filter(Boolean);
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

function findDependencyOrderConflict(proposalContent) {
  let inAffectedServices = false;
  let orderColumn = -1;
  for (const line of proposalContent.split('\n')) {
    if (/^##\s/.test(line)) {
      inAffectedServices = /^##\s+Affected Services\b/.test(line);
      orderColumn = -1;
      continue;
    }
    if (!inAffectedServices || !line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (orderColumn === -1) {
      orderColumn = cells.findIndex((c) => /dependency order/i.test(c));
      continue;
    }
    const cell = cells[orderColumn] ?? '';
    const m = cell.match(/after\s+[A-Za-z0-9_-]+/i);
    if (m) return m[0];
  }
  return null;
}

function chunkWave(wave, cap) {
  const queuesByService = new Map();
  for (const item of wave) {
    if (!queuesByService.has(item.service)) queuesByService.set(item.service, []);
    queuesByService.get(item.service).push(item);
  }
  const chunks = [];
  let remaining = wave.length;
  while (remaining > 0) {
    const chunk = [];
    for (const queue of queuesByService.values()) {
      if (chunk.length >= cap) break;
      if (queue.length === 0) continue;
      chunk.push(queue.shift());
      remaining -= 1;
    }
    chunks.push(chunk);
  }
  return chunks;
}

const args = parseArgs(process.argv);

if (args['emit-cap-only']) {
  const limit = parseInt(args.limit ?? '', 10);
  if (!Number.isInteger(limit) || limit < 1) {
    die('--limit must be a positive integer when --emit-cap-only is set');
  }
  process.stdout.write(`${resolveCap(limit, process.env)}\n`);
  process.exit(0);
}

const taskDir = args['task-dir'] || process.env.PLAN_TASK_DIR;
const strategyInput = (args['strategy'] || process.env.PLAN_STRATEGY || 'sequential').toLowerCase();
const capInput = args['phase-parallelism'] || '1';

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
let strategy = STRATEGY_MAP[strategyInput];
if (!strategy) {
  die(`unknown strategy: ${strategyInput} (expected: sequential | per-service-parallel)`);
}

const manualCap = capInput === 'auto' ? null : parseInt(capInput, 10);
if (manualCap !== null && (!Number.isInteger(manualCap) || manualCap < 1)) {
  die(`--phase-parallelism must be a positive integer or 'auto' (got: ${capInput})`);
}

let downgradeReason = null;
if (strategy === 'per-service-parallel') {
  const proposalPath = join(taskDir, 'PROPOSAL.md');
  if (existsSync(proposalPath)) {
    const conflict = findDependencyOrderConflict(readFileSync(proposalPath, 'utf8'));
    if (conflict) {
      strategy = 'sequential';
      downgradeReason = `PROPOSAL.md Affected Services declares '${conflict}' in Dependency Order — downgraded per-service-parallel to sequential`;
      process.stderr.write(`WARN: ${downgradeReason}\n`);
    }
  }
}

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
    return {
      phase: phaseIdOf(filename),
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

const crossServiceWidth = waves.reduce(
  (mx, wave) => Math.max(mx, new Set(wave.map((it) => it.service)).size),
  1,
);
const autoCap = machineAutoCap(crossServiceWidth);
const chosenCap = applyEnvCeiling(manualCap === null ? autoCap : manualCap, process.env);

waves = waves.flatMap((wave) => chunkWave(wave, chosenCap));

let summary;
if (strategy === 'sequential') {
  summary = `Sequential: ${totalPhases} phases, ${services.length} service(s), PHASE_PARALLELISM=${chosenCap}.`;
} else {
  const maxLane = Math.max(...services.map((s) => lanes[s].length));
  summary = `Per-service parallel: ${totalPhases} phases across ${services.length} service lane(s) (max ${maxLane} phases), ${waves.length} wave(s), PHASE_PARALLELISM=${chosenCap}.`;
}

const plan = {
  strategy,
  phase_parallelism: chosenCap,
  auto_cap: autoCap,
  chosen_cap: chosenCap,
  lanes,
  waves,
  summary,
};
if (downgradeReason) plan.downgrade_reason = downgradeReason;

process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
