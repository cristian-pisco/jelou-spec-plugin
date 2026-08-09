import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { LOCKFILES, frozenInstallCommand } from '../registry/package-manager.mjs';
import { isContainerLauncher, startsDevOnUp } from './launcher.mjs';

export const DEPS_MARKER = '.jlu-lock-hash';
export const INSTALL_TIMEOUT_MS = 900000;

const DEFAULT_CODE_TARGET = '/app';

function defaultReadFile(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function defaultExists(p) {
  return existsSync(p);
}

function io({ exists, readFile }) {
  return { exists: exists || defaultExists, readFile: readFile || defaultReadFile };
}

export function detectLockfile(dir, deps = {}) {
  const { exists, readFile } = io(deps);
  for (const candidate of LOCKFILES) {
    const path = `${dir}/${candidate.file}`;
    if (!exists(path)) continue;
    const content = readFile(path);
    if (content === null) continue;
    return {
      file: candidate.file,
      manager: candidate.manager,
      installCmd: frozenInstallCommand(candidate.manager),
      hash: createHash('sha256').update(content).digest('hex').slice(0, 12)
    };
  }
  return null;
}

export function depsVolumeName({ serviceId, slug, lockHash }) {
  return `jlu-nm-${serviceId}-${slug}-${lockHash}`;
}

export function codeMountTarget(mounts, candidateSources) {
  const sources = new Set(candidateSources || []);
  const bind = (mounts || []).find((m) => m.type === 'bind' && sources.has(m.source));
  return bind ? bind.target : null;
}

export function shadowingDepsMount(mounts, codeTarget) {
  return (mounts || []).find((m) => m.target === `${codeTarget}/node_modules`) || null;
}

export function guardedInstallScript({ cwd, installCmd, lockHash, logPath }) {
  return [
    `cd ${cwd} || exit 1`,
    `if [ "$(cat node_modules/${DEPS_MARKER} 2>/dev/null)" = "${lockHash}" ]; then exit 0; fi`,
    `{ ${installCmd} && printf %s ${lockHash} > node_modules/${DEPS_MARKER}; } > ${logPath} 2>&1`
  ].join('; ');
}

function declaredDeps(dir, readFile) {
  try {
    const pkg = JSON.parse(readFile(`${dir}/package.json`));
    return [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
  } catch {
    return null;
  }
}

function unresolvedDeps(nodeModulesDir, deps, exists) {
  return (deps || []).filter((name) => !exists(`${nodeModulesDir}/${name}`));
}

function hostInstallState({ dir, lockHash, fs }) {
  const nodeModules = `${dir}/node_modules`;
  if (markerMatches(`${nodeModules}/${DEPS_MARKER}`, lockHash, fs.readFile)) return { satisfied: true, adopted: false, missing: [] };
  if (!fs.exists(nodeModules)) return { satisfied: false, adopted: false, missing: null };
  const deps = declaredDeps(dir, fs.readFile);
  if (deps === null) return { satisfied: false, adopted: false, missing: null };
  const missing = unresolvedDeps(nodeModules, deps, fs.exists);
  return { satisfied: missing.length === 0, adopted: missing.length === 0, missing };
}

function markerMatches(path, lockHash, readFile) {
  const found = readFile(path);
  return found !== null && found.trim() === lockHash;
}

function installStep({ cwd, runsIn, lock, serviceId, slug }) {
  const logPath = `/tmp/jlu-install-${serviceId}-${slug}.log`;
  return {
    runs_in: runsIn,
    cwd,
    cmd: guardedInstallScript({ cwd, installCmd: lock.installCmd, lockHash: lock.hash, logPath }),
    timeoutMs: INSTALL_TIMEOUT_MS,
    logPath
  };
}

function provision({ source, lock, mountTarget, volumeName = null, satisfied, install = null, adopted = false, missing = null, unverified = false }) {
  return { source, lockFile: lock.file, lockHash: lock.hash, volumeName, mountTarget, satisfied, adopted, missing, install, unverified };
}

export function resolveDepsProvision({
  launcher,
  serviceId,
  slug,
  worktreeDir,
  canonicalPath,
  mounts,
  exists,
  readFile
}) {
  const fs = io({ exists, readFile });
  const lock = detectLockfile(worktreeDir, fs);
  if (!lock) return null;

  if (!isContainerLauncher(launcher)) {
    const state = hostInstallState({ dir: worktreeDir, lockHash: lock.hash, fs });
    return provision({
      source: 'worktree',
      lock,
      mountTarget: null,
      satisfied: state.satisfied,
      adopted: state.adopted,
      missing: state.missing,
      install: state.satisfied ? null : installStep({ cwd: worktreeDir, runsIn: 'host', lock, serviceId, slug })
    });
  }

  const codeTarget = codeMountTarget(mounts, [worktreeDir, canonicalPath]) || DEFAULT_CODE_TARGET;
  const mountTarget = `${codeTarget}/node_modules`;
  const containerInstall = () => installStep({ cwd: codeTarget, runsIn: 'container', lock, serviceId, slug });

  if (shadowingDepsMount(mounts, codeTarget) && startsDevOnUp(launcher)) {
    return provision({ source: 'image', lock, mountTarget, satisfied: true, unverified: true });
  }

  if (shadowingDepsMount(mounts, codeTarget)) {
    return provision({
      source: 'named-volume',
      lock,
      mountTarget,
      volumeName: depsVolumeName({ serviceId, slug, lockHash: lock.hash }),
      satisfied: false,
      install: containerInstall()
    });
  }

  if (fs.exists(`${worktreeDir}/node_modules`)) {
    const state = hostInstallState({ dir: worktreeDir, lockHash: lock.hash, fs });
    return provision({
      source: 'worktree-bind',
      lock,
      mountTarget,
      satisfied: state.satisfied,
      adopted: state.adopted,
      missing: state.missing,
      install: state.satisfied ? null : containerInstall()
    });
  }

  const canonicalLock = detectLockfile(canonicalPath, fs);
  if (canonicalLock && canonicalLock.hash === lock.hash && fs.exists(`${canonicalPath}/node_modules`)) {
    return provision({ source: 'canonical', lock, mountTarget, satisfied: true });
  }

  return provision({
    source: 'named-volume',
    lock,
    mountTarget,
    volumeName: depsVolumeName({ serviceId, slug, lockHash: lock.hash }),
    satisfied: false,
    install: containerInstall()
  });
}
