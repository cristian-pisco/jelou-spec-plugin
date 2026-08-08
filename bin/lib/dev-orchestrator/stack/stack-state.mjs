import { chmodSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stateDir } from '../state.mjs';

export function stackStatePath(opts) {
  return join(stateDir(opts), 'stack-state.json');
}

export function emptyStackState() {
  return { projects: [], hostPids: [], frontendEnv: null, backendEnvBackups: [], portAllocations: [], environmentOverlays: [], localAuthProfile: null, currentRun: null, mutationJournal: [] };
}

function containsSecret(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => /password|secret|cookie|token/i.test(key) || containsSecret(child));
}

export function setLocalAuthProfile(state, profile) {
  if (containsSecret(profile)) throw new Error('local auth profile must not contain secrets');
  return { ...state, localAuthProfile: structuredClone(profile) };
}

function normalizedRunMarker(marker) {
  const fields = ['workspaceId', 'taskSlug', 'runId'];
  if (!marker || fields.some((field) => typeof marker[field] !== 'string' || marker[field].length === 0)) {
    throw new Error('ownership marker requires workspaceId, taskSlug, and runId');
  }
  return { workspaceId: marker.workspaceId, taskSlug: marker.taskSlug, runId: marker.runId };
}

function sameRun(left, right) {
  return left.workspaceId === right.workspaceId && left.taskSlug === right.taskSlug && left.runId === right.runId;
}

export function recordOwnedMutation(state, identity, mutation) {
  const marker = normalizedRunMarker(identity);
  if (state.currentRun && !sameRun(state.currentRun, marker)) throw new Error('current run marker mismatch');
  return {
    ...state,
    currentRun: marker,
    mutationJournal: [...(state.mutationJournal || []), { ...mutation, marker }],
  };
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
  const temporary = `${p}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, p);
  chmodSync(p, 0o600);
  return p;
}

export function clearStackState(opts) {
  const p = stackStatePath(opts);
  if (existsSync(p)) rmSync(p);
}
