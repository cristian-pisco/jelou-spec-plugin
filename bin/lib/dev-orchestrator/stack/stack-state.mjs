import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stateDir } from '../state.mjs';

export function stackStatePath(opts) {
  return join(stateDir(opts), 'stack-state.json');
}

export function emptyStackState() {
  return { projects: [], hostPids: [], frontendEnv: null, backendEnvBackups: [] };
}

export function addProject(state, project) {
  const projects = state.projects.filter((p) => p.projectName !== project.projectName);
  projects.push(project);
  return { ...state, projects };
}

export function addHostPid(state, entry) {
  const hostPids = state.hostPids.filter((h) => h.role !== entry.role);
  hostPids.unshift(entry);
  return { ...state, hostPids };
}

export function setFrontendEnv(state, frontendEnv) {
  return { ...state, frontendEnv };
}

export function addBackendEnvBackup(state, backup) {
  const backendEnvBackups = state.backendEnvBackups.filter((b) => b.path !== backup.path);
  backendEnvBackups.push(backup);
  return { ...state, backendEnvBackups };
}

export function readStackState(opts) {
  const p = stackStatePath(opts);
  if (!existsSync(p)) return emptyStackState();
  try {
    return { ...emptyStackState(), ...JSON.parse(readFileSync(p, 'utf8')) };
  } catch {
    return emptyStackState();
  }
}

export function writeStackState(opts, state) {
  const p = stackStatePath(opts);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return p;
}

export function clearStackState(opts) {
  const p = stackStatePath(opts);
  if (existsSync(p)) rmSync(p);
}
