import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const LOCKFILES = [
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'package-lock.json', manager: 'npm' }
];

export const MANAGERS = ['npm', 'yarn', 'pnpm', 'bun'];

const FROZEN_INSTALL = {
  npm: 'npm ci',
  yarn: 'yarn install --frozen-lockfile',
  pnpm: 'pnpm install --frozen-lockfile',
  bun: 'bun install --frozen-lockfile'
};

function defaultExists(p) {
  try { return statSync(p).isFile(); } catch { return existsSync(p); }
}

export function detectPackageManager(dir, { exists = defaultExists } = {}) {
  for (const { file, manager } of LOCKFILES) {
    if (exists(join(dir, file))) return manager;
  }
  if (exists(join(dir, 'package.json'))) return 'npm';
  return null;
}

export function frozenInstallCommand(manager) {
  return FROZEN_INSTALL[manager] || null;
}

export function runCommand(manager, script) {
  switch (manager) {
    case 'yarn': return `yarn ${script}`;
    case 'pnpm': return `pnpm ${script}`;
    case 'bun': return `bun run ${script}`;
    case 'npm':
    default: return `npm run ${script}`;
  }
}

export function commandManager(command) {
  if (typeof command !== 'string') return null;
  for (const token of command.split(/\s+/)) {
    if (MANAGERS.includes(token)) return token;
  }
  return null;
}

export function lockfileForManager(manager) {
  const found = LOCKFILES.find((candidate) => candidate.manager === manager);
  return found ? found.file : null;
}

export function addCommand(manager, packages, { dev = false } = {}) {
  const list = (Array.isArray(packages) ? packages : [packages]).filter(Boolean);
  if (!list.length) return null;
  const pkgs = list.join(' ');
  switch (manager) {
    case 'yarn': return `yarn add ${dev ? '-D ' : ''}${pkgs}`;
    case 'pnpm': return `pnpm add ${dev ? '-D ' : ''}${pkgs}`;
    case 'bun': return `bun add ${dev ? '-d ' : ''}${pkgs}`;
    case 'npm':
    default: return `npm install ${dev ? '-D ' : ''}${pkgs}`;
  }
}

export function resolveServicePackageManager({ entry, detect = detectPackageManager } = {}) {
  const declared = entry && entry.dev && entry.dev.package_manager;
  if (declared) {
    if (!MANAGERS.includes(declared)) {
      return { manager: null, source: 'invalid', lockFile: null, declared };
    }
    return { manager: declared, source: 'declared', lockFile: lockfileForManager(declared), declared };
  }
  const detected = entry && entry.path ? detect(entry.path) : null;
  if (!detected) return { manager: null, source: 'unknown', lockFile: null, declared: null };
  return { manager: detected, source: 'detected', lockFile: lockfileForManager(detected), declared: null };
}
