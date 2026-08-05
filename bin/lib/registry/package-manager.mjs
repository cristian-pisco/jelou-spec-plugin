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
