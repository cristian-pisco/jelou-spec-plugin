// bin/lib/dev-orchestrator/register.mjs
//
// Pure helpers used by /jlu:register-service. No I/O against tmux or daemon —
// only JSON config + filesystem inspection in the target service directory.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { DEFAULTS, readConfig } from './config.mjs';

export function loadOrInitConfig(configPath) {
  if (existsSync(configPath)) return readConfig(configPath);
  return { version: 1, defaults: { ...DEFAULTS }, services: [] };
}

export function addOrUpdateService(cfg, service) {
  const services = (cfg.services || []).slice();
  const idx = services.findIndex(s => s.name === service.name);
  if (idx === -1) {
    services.push(service);
  } else {
    services[idx] = service;
  }
  return { ...cfg, services };
}

function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

function detectPackageManager(absDir) {
  if (isFile(join(absDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (isFile(join(absDir, 'yarn.lock'))) return 'yarn';
  if (isFile(join(absDir, 'bun.lockb'))) return 'bun';
  if (isFile(join(absDir, 'package-lock.json'))) return 'npm';
  if (isFile(join(absDir, 'package.json'))) return 'npm';
  return null;
}

function suggestedCommandFor(pm) {
  switch (pm) {
    case 'pnpm': return 'pnpm dev';
    case 'yarn': return 'yarn dev';
    case 'bun':  return 'bun dev';
    case 'npm':  return 'npm run dev';
    default:     return null;
  }
}

function listDotEnvFiles(absDir) {
  if (!existsSync(absDir)) return [];
  return readdirSync(absDir).filter(n => n === '.env' || n.startsWith('.env.'));
}

const SERVICE_KEY_RE = /^ {2}([A-Za-z0-9_.-]+):\s*$/;

export function inferComposeServices(composeFilePath) {
  if (!existsSync(composeFilePath)) return [];
  const lines = readFileSync(composeFilePath, 'utf8').split(/\r?\n/);
  let inServices = false;
  const out = [];
  for (const raw of lines) {
    if (/^services:\s*$/.test(raw)) { inServices = true; continue; }
    if (inServices && /^[A-Za-z0-9_.-]+:\s*$/.test(raw)) {
      // top-level non-services key — section ended
      inServices = false;
      continue;
    }
    if (inServices) {
      const m = SERVICE_KEY_RE.exec(raw);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

function findComposeFile(absDir) {
  for (const name of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const p = join(absDir, name);
    if (isFile(p)) return p;
  }
  return null;
}

export function inferDefaults(absDir) {
  const pm = detectPackageManager(absDir);
  const compose = findComposeFile(absDir);
  return {
    directoryName: basename(absDir),
    packageManager: pm,
    suggestedCommand: suggestedCommandFor(pm),
    dotEnvFiles: listDotEnvFiles(absDir),
    composeFile: compose,
    composeServices: compose ? inferComposeServices(compose) : []
  };
}
