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

const PORT_RE_DOTENV = /^PORT\s*=\s*(\d{2,5})\s*$/m;
const PORT_RE_LISTEN = /\.listen\s*\(\s*(\d{2,5})/;
const PORT_RE_SCRIPT = /PORT\s*=\s*(\d{2,5})/;

function safeRead(path) {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 64 * 1024) return null;
    return readFileSync(path, 'utf8');
  } catch { return null; }
}

export function inferPortFromSource(absDir) {
  if (!existsSync(absDir)) return null;
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch { return null; }

  // .env first (highest priority).
  for (const e of entries) {
    if (e.isFile() && (e.name === '.env' || e.name.startsWith('.env.'))) {
      const body = safeRead(join(absDir, e.name));
      const m = body && body.match(PORT_RE_DOTENV);
      if (m) return parseInt(m[1], 10);
    }
  }

  // package.json scripts (next priority).
  const pkg = safeRead(join(absDir, 'package.json'));
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      const scripts = (parsed && parsed.scripts) || {};
      for (const v of Object.values(scripts)) {
        const m = String(v).match(PORT_RE_SCRIPT);
        if (m) return parseInt(m[1], 10);
      }
    } catch { /* skip */ }
  }

  // Top-level JS/TS files.
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.(js|mjs|cjs|ts|tsx)$/.test(e.name)) continue;
    const body = safeRead(join(absDir, e.name));
    const m = body && body.match(PORT_RE_LISTEN);
    if (m) return parseInt(m[1], 10);
  }

  return null;
}

export function inferDefaults(absDir) {
  const pm = detectPackageManager(absDir);
  const compose = findComposeFile(absDir);
  const port = inferPortFromSource(absDir);
  return {
    directoryName: basename(absDir),
    packageManager: pm,
    suggestedCommand: suggestedCommandFor(pm),
    dotEnvFiles: listDotEnvFiles(absDir),
    composeFile: compose,
    composeServices: compose ? inferComposeServices(compose) : [],
    detectedPort: port,
    suggestedReadinessUrl: port ? `http://localhost:${port}/health` : null
  };
}
