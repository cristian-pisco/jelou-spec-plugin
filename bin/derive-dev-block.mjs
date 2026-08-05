#!/usr/bin/env node
// bin/derive-dev-block.mjs — infer a services.yaml `dev:` block for a service
// that has none, so /jlu-goal can boot it DETERMINISTICALLY instead
// of improvising a launcher/command (the failure that booted backends with the
// wrong package manager: `docker exec yarn dev` on an npm project).
//
// Two patterns are handled:
//   1. idle-dev-container — Dockerfile(.dev) ends in `sleep infinity` /
//      `tail -f /dev/null`; the app is started with
//      `docker compose exec <svc> <pkg-manager> run <script>`. → launcher: docker-exec
//   2. host dev server — runs on the host (`npm run dev`, Vite, …). → launcher: npm
//
// The package manager and dev script are DETECTED, never assumed: lockfile →
// pm, package.json scripts → dev script (start:dev > dev > start:debug > start).
//
// CLI:  node bin/derive-dev-block.mjs <service-dir> [--stack <stack>]
//   prints JSON { block, source, warnings } or { block: null, reason } and
//   exits 0 (derivable) / 3 (not derivable — caller must refuse, never guess).
//
// Pure exports (unit-tested): detectPackageManager, pickDevScript, runCommand,
// parseComposeServicePorts, isIdleDevContainer, deriveDevBlock.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { toYaml } from './lib/registry/yaml-lite.mjs';

function isFile(p) { try { return statSync(p).isFile(); } catch { return false; } }

function safeRead(p) {
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size > 256 * 1024) return null;
    return readFileSync(p, 'utf8');
  } catch { return null; }
}

import { detectPackageManager, runCommand } from './lib/registry/package-manager.mjs';

export { detectPackageManager, runCommand };

// Preference order: a dedicated dev/watch script beats a production `start`.
const DEV_SCRIPT_PREFERENCE = ['start:dev', 'dev', 'start:debug', 'serve', 'develop', 'start'];

export function pickDevScript(scripts) {
  if (!scripts || typeof scripts !== 'object') return null;
  for (const name of DEV_SCRIPT_PREFERENCE) {
    if (typeof scripts[name] === 'string' && scripts[name].trim()) return name;
  }
  return null;
}



const CANONICAL_COMPOSE_NAMES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
const COMPOSE_NAME_RE = /^(?:docker-)?compose(?:[.-][\w.-]+)?\.ya?ml$/;

export function composeCandidates(dir) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return []; }
  const found = entries.filter((name) => COMPOSE_NAME_RE.test(name) && isFile(join(dir, name)));
  const canonical = CANONICAL_COMPOSE_NAMES.filter((name) => found.includes(name));
  const overlays = found.filter((name) => !CANONICAL_COMPOSE_NAMES.includes(name)).sort();
  return [...canonical, ...overlays];
}

function resolveComposeFile(dir, declared, warnings) {
  const candidates = composeCandidates(dir);
  if (declared) {
    if (isFile(join(dir, declared))) return declared;
    warnings.push(`declared compose file not found in ${dir}: ${declared} — falling back to discovery`);
  }
  const picked = candidates[0] || null;
  if (picked && candidates.length > 1) {
    warnings.push(`multiple compose files (${candidates.join(', ')}); picked "${picked}" — pass --compose-file to override`);
  }
  return picked;
}

// Indentation in real compose files varies (2 vs 4 spaces) and list items carry
// trailing comments (`- "8787:8080" #Server`). Parse indent-agnostically rather
// than assume a fixed width.
function stripComment(line) {
  let inS = false; let inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line.replace(/\s+$/, '');
}

function indentOf(line) {
  const m = /^(\s*)/.exec(line);
  return m[1].replace(/\t/g, '  ').length;
}

// Map<serviceName, [{ ind, raw }]> for the children of the top-level `services:`.
function composeServiceBlocks(text) {
  const result = new Map();
  if (typeof text !== 'string') return result;
  const lines = text.split(/\r?\n/).map(stripComment).filter((l) => l.trim() !== '');
  let i = 0;
  while (i < lines.length && !/^services:\s*$/.test(lines[i])) i++;
  if (i >= lines.length) return result;
  i++;
  const block = [];
  for (; i < lines.length; i++) {
    if (indentOf(lines[i]) <= 0) break; // a new top-level key ended the services section
    block.push({ ind: indentOf(lines[i]), raw: lines[i] });
  }
  if (block.length === 0) return result;
  const childIndent = Math.min(...block.map((b) => b.ind));
  let cur = null;
  for (const { ind, raw } of block) {
    if (ind === childIndent) {
      // Service header: `app:` or `app: &anchor` (YAML anchor — idiomatic in
      // extended compose files; the value, if any, must be a bare anchor).
      const m = /^\s*([A-Za-z0-9_.-]+):(?:\s+&\S+)?\s*$/.exec(raw);
      if (m) { cur = m[1]; result.set(cur, []); continue; }
    }
    if (cur) result.get(cur).push({ ind, raw });
  }
  return result;
}

function inferComposeServices(composeText) {
  return [...composeServiceBlocks(composeText).keys()];
}

// Container ports that are debuggers/inspectors, never the app's HTTP listener.
const DEBUGGER_CONTAINER_PORTS = new Set([9001, 9229, 9230, 5858]);

// Parse `ports:` for one compose service into [{ host, container }]. Handles the
// common `"H:C"` / `H:C` short forms with trailing comments; ignores long-form
// object entries by returning what it can.
export function parseComposeServicePorts(composeText, service) {
  const lines = composeServiceBlocks(composeText).get(service);
  if (!lines) return [];
  const out = [];
  let inPorts = false;
  let portsIndent = -1;
  for (const { ind, raw } of lines) {
    const keyM = /^\s*([A-Za-z0-9_.-]+):\s*$/.exec(raw);
    if (keyM && keyM[1] === 'ports') { inPorts = true; portsIndent = ind; continue; }
    if (inPorts) {
      if (ind <= portsIndent && !/^\s*-/.test(raw)) { inPorts = false; continue; }
      const item = /^\s*-\s*["']?(\d{2,5}):(\d{2,5})["']?/.exec(raw);
      if (item) out.push({ host: Number(item[1]), container: Number(item[2]) });
    }
  }
  return out;
}

// Pick the app's primary HOST port: first mapping whose container side is not a
// known debugger port.
export function primaryHostPort(portMaps) {
  const appMaps = portMaps.filter((p) => !DEBUGGER_CONTAINER_PORTS.has(p.container));
  return (appMaps[0] || portMaps[0] || {}).host ?? null;
}

// Matches both shell form (`CMD sleep infinity`) and JSON exec form
// (`CMD ["tail","-f","/dev/null"]`) — separators may be spaces or `","`.
const IDLE_RE = /sleep["',\s]+infinity|tail["',\s]+-f["',\s]+\/dev\/null/;

// True when a Dockerfile in `dir` idles instead of running the app — the signal
// that the app must be started via `docker compose exec`, not `up -d` alone.
export function isIdleDevContainer(dir) {
  for (const name of ['Dockerfile.dev', 'Dockerfile.local', 'Dockerfile']) {
    const body = safeRead(join(dir, name));
    if (body && IDLE_RE.test(body)) return true;
  }
  return false;
}

// Per-stack readiness + RAM hints, keyed off the resolved script COMMAND (e.g.
// "nest start --watch", "vite ...") — not the script name. NestJS/Nest print a
// reliable "started" line; front-end dev servers print their own.
function readinessFor(stack, scriptCmd, hostPort) {
  const s = (stack || '').toLowerCase();
  if (s === 'nestjs' || /\bnest\b/.test(scriptCmd)) {
    return { ready_signal: { type: 'stdout_match', pattern: 'Nest application successfully started' } };
  }
  if (s === 'nextjs' || /\bnext\b/.test(scriptCmd)) {
    return { ready_signal: { type: 'stdout_match', pattern: '✓ Ready in' } };
  }
  if (/\bvite\b/.test(scriptCmd)) {
    return { ready_signal: { type: 'stdout_match', pattern: 'Local:.*http' } };
  }
  if (hostPort) return { ready_signal: { type: 'http_200', port: hostPort, path: '/' } };
  return { ready_signal: { type: 'stdout_match', pattern: 'listening|started|ready' } };
}

function ramFor(stack) {
  const s = (stack || '').toLowerCase();
  if (s === 'nextjs') return 600;
  if (s === 'nestjs') return 350;
  if (['react', 'vue', 'angular', 'svelte'].includes(s)) return 400;
  return 300;
}

// Compose service names that are infrastructure, never the app whose dev server
// we exec — used to avoid picking the DB when the app service isn't named `app`.
const INFRA_SERVICE_RE = /^(postgres|postgresql|pg|mysql|mariadb|mongo|mongodb|redis|rabbitmq|rabbit|kafka|zookeeper|elasticsearch|elastic|opensearch|memcached|localstack|minio|db|database|cache|queue|broker|mailhog|adminer)$/i;

// Best-effort process matcher for teardown (pkill), keyed off the resolved
// script command (and package manager) so it targets the real dev process.
function procHint(scriptCmd, pm) {
  const c = (scriptCmd || '').toLowerCase();
  if (/\bnest\b/.test(c)) return 'nest start';
  if (/\bnext\b/.test(c)) return 'next dev';
  if (/\bvite\b/.test(c)) return 'vite';
  if (/\bnodemon\b/.test(c)) return 'nodemon';
  if (pm === 'bun' || /\bbun\b/.test(c)) return 'bun';
  return 'node';
}

const GENERIC_DIR_NAMES = new Set([
  'app', 'apps', 'src', 'api', 'web', 'ui', 'www', 'server', 'client', 'service', 'services',
  'backend', 'frontend', 'packages', 'package', 'dist', 'build', 'main', 'core', 'repo', 'code',
]);
const ENTRY_SCRIPT_RE = /^[\w@./-]+\.(?:ts|tsx|js|mjs|cjs)$/;

function ereEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function selfMatchGuard(escaped) {
  const i = escaped.search(/[A-Za-z0-9]/);
  return i === -1 ? escaped : `${escaped.slice(0, i)}[${escaped[i]}]${escaped.slice(i + 1)}`;
}

function checkoutAnchor(dir) {
  const parts = String(dir).split('/').filter(Boolean);
  const leaf = parts[parts.length - 1] || '';
  const parent = parts[parts.length - 2] || '';
  const useParent = parent && GENERIC_DIR_NAMES.has(leaf.toLowerCase());
  const escapedLeaf = selfMatchGuard(ereEscape(leaf));
  return useParent ? `${ereEscape(parent)}/${escapedLeaf}` : escapedLeaf;
}

function entryScript(scriptCmd) {
  let entry = null;
  for (const token of String(scriptCmd || '').split(/\s+/)) {
    const cleaned = token.replace(/^\.\//, '');
    if (ENTRY_SCRIPT_RE.test(cleaned)) entry = cleaned;
  }
  return entry;
}

export function hostTeardownPattern(dir, scriptCmd, pm) {
  const entry = entryScript(scriptCmd);
  const discriminator = entry ? ereEscape(entry) : procHint(scriptCmd, pm);
  return `${checkoutAnchor(dir)}.*${discriminator}`;
}

export function deriveDevBlock(dir, { stack, composeFile: declaredComposeFile } = {}) {
  const warnings = [];
  const pm = detectPackageManager(dir);
  if (!pm) return { block: null, reason: `no package.json / lockfile in ${dir} — cannot detect a package manager` };

  const pkgRaw = safeRead(join(dir, 'package.json'));
  let scripts = {};
  if (pkgRaw) { try { scripts = (JSON.parse(pkgRaw).scripts) || {}; } catch { /* keep empty */ } }
  const script = pickDevScript(scripts);
  if (!script) {
    return { block: null, reason: `no dev script in ${dir}/package.json (looked for ${DEV_SCRIPT_PREFERENCE.join(', ')})` };
  }
  const scriptCmd = String(scripts[script] || '');
  const command = runCommand(pm, script);

  const composeFile = resolveComposeFile(dir, declaredComposeFile, warnings);
  const idle = composeFile && isIdleDevContainer(dir);

  if (idle) {
    const composeText = safeRead(join(dir, composeFile)) || '';
    const services = inferComposeServices(composeText);
    let svc;
    if (services.includes('app')) svc = 'app';
    else if (services.includes(basename(dir))) svc = basename(dir);
    else {
      // Last-resort pick: prefer a non-infra service over the first (compose
      // files often list postgres/redis before the API).
      const nonInfra = services.filter((s) => !INFRA_SERVICE_RE.test(s));
      svc = nonInfra[0] || services[0] || null;
      if (svc && services.length > 1) {
        warnings.push(`compose declares multiple services (${services.join(', ')}); picked "${svc}" — confirm it is the app`);
      }
    }
    if (!svc) return { block: null, reason: `idle dev container but no compose service found in ${composeFile}` };
    const portMaps = parseComposeServicePorts(composeText, svc);
    const hostPort = primaryHostPort(portMaps);
    if (!hostPort) warnings.push(`could not read a host port mapping for "${svc}" in ${composeFile}; set ready_signal manually if needed`);
    const block = {
      launcher: 'docker-exec',
      docker: { service: svc, compose_file: composeFile },
      command,
      teardown: `docker compose -f ${composeFile} exec -T ${svc} pkill -f '${procHint(scriptCmd, pm)}' || true`,
      ...readinessFor(stack, scriptCmd, hostPort),
      ready_timeout_s: 90,
      ram_estimate_mb: ramFor(stack),
      data_isolation: 'none',
    };
    return { block, source: 'derived:docker-exec', warnings };
  }

  if (composeFile) {
    // App container runs the app directly (no idle marker): the existing
    // launcher: docker derivation (`up -d` + readiness) is correct.
    const block = {
      launcher: 'docker',
      docker: { compose_file: composeFile },
      ...readinessFor(stack, scriptCmd, null),
      ready_timeout_s: 60,
      ram_estimate_mb: ramFor(stack),
      data_isolation: 'none',
    };
    warnings.push(`${composeFile} present without an idle marker — assumed the container runs the app itself (launcher: docker); confirm it does not need an exec`);
    return { block, source: 'derived:docker', warnings };
  }

  // Host dev server.
  const hostPort = null;
  const teardownPattern = hostTeardownPattern(dir, scriptCmd, pm);
  warnings.push(`host teardown is anchored on the checkout: confirm it matches the real process with \`pgrep -af "${teardownPattern}"\` while the dev server runs (a hoisted/relocated checkout can make it match nothing)`);
  const block = {
    launcher: pm === 'npm' ? 'npm' : 'shell',
    command,
    teardown: `pkill -f '${teardownPattern}' || true`,
    env_files: ['.env', '.env.e2e'],
    ...readinessFor(stack, scriptCmd, hostPort),
    ready_timeout_s: 90,
    ram_estimate_mb: ramFor(stack),
    data_isolation: 'none',
  };
  return { block, source: 'derived:host', warnings };
}

export function devBlockToYaml(block) {
  return `dev:\n${toYaml(block)}`;
}

function isMain() {
  return process.argv[1] && process.argv[1].endsWith('derive-dev-block.mjs');
}

if (isMain()) {
  const args = process.argv.slice(2);
  const flagValueIndexes = new Set();
  const flagValue = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    flagValueIndexes.add(i + 1);
    return args[i + 1];
  };
  const stack = flagValue('--stack');
  const composeFile = flagValue('--compose-file');
  const dir = args.find((a, i) => !a.startsWith('--') && !flagValueIndexes.has(i));
  if (!dir) {
    console.error('usage: derive-dev-block.mjs <service-dir> [--stack <stack>] [--compose-file <name>]');
    process.exit(2);
  }
  if (!existsSync(dir)) {
    console.error(`derive-dev-block: directory not found: ${dir}`);
    process.exit(2);
  }
  const result = deriveDevBlock(dir, { stack, composeFile });
  if (result.block) result.yaml = devBlockToYaml(result.block);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.block ? 0 : 3);
}
