import { createHash } from 'node:crypto';
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseYamlLite, toYaml } from './yaml-lite.mjs';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

export function computeDevBlockHash(blockObj) {
  const { verified, ...rest } = blockObj || {};
  return createHash('sha256').update(JSON.stringify(canonicalize(rest))).digest('hex');
}

export function lineIndent(line) {
  return line.length - line.trimStart().length;
}

const TEARDOWN_HOST_LAUNCHERS = new Set(['npm', 'make', 'shell']);
const REMOTE_EXEC_COMMANDS = new Set(['docker', 'docker-compose', 'podman', 'kubectl', 'ssh', 'nerdctl']);
const BARE_PROCESS_TARGETS = new Set([
  'node', 'nodejs', 'deno', 'bun', 'tsx', 'ts-node', 'nodemon', 'pm2',
  'vite', 'webpack', 'webpack-dev-server', 'esbuild', 'rollup', 'parcel', 'turbo',
  'next', 'next dev', 'nest', 'nest start', 'remix', 'nuxt', 'ng', 'ng serve',
  'npm', 'npm run dev', 'npm start', 'yarn', 'yarn dev', 'pnpm', 'pnpm dev',
  'python', 'python3', 'uvicorn', 'gunicorn', 'flask', 'ruby', 'rails', 'php', 'java', 'dotnet', 'air', 'go',
]);

function splitShellSegments(cmd) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i += 1) {
    const c = cmd[i];
    if (quote) {
      current += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; current += c; continue; }
    if (c === ';' || c === '\n' || c === '&' || c === '|') {
      segments.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter(Boolean);
}

function tokenizeSegment(segment) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < segment.length; i += 1) {
    const c = segment[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      current += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (/\s/.test(c)) {
      if (current) { tokens.push(current); current = ''; }
      continue;
    }
    current += c;
  }
  if (current) tokens.push(current);
  return tokens;
}

function normalizePattern(pattern) {
  return pattern
    .replace(/\[([^\]])\]/g, '$1')
    .replace(/\\(.)/g, '$1')
    .replace(/\.[*+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function pkillTargets(teardown) {
  const targets = [];
  for (const segment of splitShellSegments(String(teardown || ''))) {
    const tokens = tokenizeSegment(segment);
    if (tokens.length === 0) continue;
    const program = tokens[0].split('/').pop();
    if (REMOTE_EXEC_COMMANDS.has(program)) continue;
    if (program !== 'pkill' && program !== 'killall') continue;
    const args = tokens.slice(1).filter((t) => !t.startsWith('-'));
    if (args.length === 0) continue;
    targets.push({ pattern: args.join(' ') });
  }
  return targets;
}

export function teardownSafetyCause(block) {
  if (!block || !TEARDOWN_HOST_LAUNCHERS.has(block.launcher)) return null;
  const teardown = typeof block.teardown === 'string' ? block.teardown : '';
  if (!teardown.trim()) return null;
  for (const { pattern } of pkillTargets(teardown)) {
    if (!BARE_PROCESS_TARGETS.has(normalizePattern(pattern))) continue;
    return `unsafe_teardown: host teardown pattern '${pattern}' matches every such process on the machine, `
      + 'not just this service; anchor it on the checkout and its entry file '
      + "(e.g. pkill -f '[s]ervice-dir.*src/index\\.ts')";
  }
  return null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function locateServicesRoot(lines) {
  const rootIndex = lines.findIndex((line) => /^services:\s*(#.*)?$/.test(line));
  if (rootIndex === -1) return null;
  const end = subtreeEnd(lines, rootIndex, 0, lines.length - 1);
  const childIndent = firstChildIndent(lines, rootIndex, end);
  if (childIndent === null) return null;
  return { rootIndex, end, childIndent };
}

function findServiceLine(lines, serviceId) {
  const root = locateServicesRoot(lines);
  if (!root) return null;
  const re = new RegExp(`^${' '.repeat(root.childIndent)}${escapeRegExp(serviceId)}:\\s*(#.*)?$`);
  for (let i = root.rootIndex + 1; i <= root.end; i++) {
    if (re.test(lines[i])) return { index: i, indent: root.childIndent };
  }
  return null;
}

function subtreeEnd(lines, keyIndex, keyIndent, hardEnd) {
  let end = keyIndex;
  for (let i = keyIndex + 1; i <= hardEnd; i++) {
    if (lines[i].trim() === '') continue;
    if (lineIndent(lines[i]) <= keyIndent) break;
    end = i;
  }
  return end;
}

function firstChildIndent(lines, keyIndex, end) {
  for (let i = keyIndex + 1; i <= end; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const ind = lineIndent(lines[i]);
    return ind > lineIndent(lines[keyIndex]) ? ind : null;
  }
  return null;
}

function findChildKey(lines, keyIndex, end, childIndent, key) {
  const re = new RegExp(`^${' '.repeat(childIndent)}${escapeRegExp(key)}:\\s*(#.*)?$`);
  for (let i = keyIndex + 1; i <= end; i++) {
    if (re.test(lines[i])) return i;
  }
  return null;
}

function locateService(lines, serviceId) {
  const svc = findServiceLine(lines, serviceId);
  if (!svc) throw new Error(`service '${serviceId}' not found in services.yaml`);
  const end = subtreeEnd(lines, svc.index, svc.indent, lines.length - 1);
  const childIndent = firstChildIndent(lines, svc.index, end) ?? svc.indent + 2;
  return { ...svc, end, childIndent };
}

export function spliceDevBlock(fileText, serviceId, blockObj) {
  const lines = fileText.split('\n');
  const svc = locateService(lines, serviceId);
  const pad = ' '.repeat(svc.childIndent);
  const rendered = [`${pad}dev:`, ...toYaml(blockObj, pad + '  ').split('\n')];
  const devIdx = findChildKey(lines, svc.index, svc.end, svc.childIndent, 'dev');
  if (devIdx !== null) {
    const devEnd = subtreeEnd(lines, devIdx, svc.childIndent, svc.end);
    lines.splice(devIdx, devEnd - devIdx + 1, ...rendered);
  } else {
    lines.splice(svc.end + 1, 0, ...rendered);
  }
  return lines.join('\n');
}

export function spliceVerifiedMark(fileText, serviceId, mark) {
  const lines = fileText.split('\n');
  const svc = locateService(lines, serviceId);
  const devIdx = findChildKey(lines, svc.index, svc.end, svc.childIndent, 'dev');
  if (devIdx === null) throw new Error(`service '${serviceId}' has no dev block to mark`);
  const devEnd = subtreeEnd(lines, devIdx, svc.childIndent, svc.end);
  const devChildIndent = firstChildIndent(lines, devIdx, devEnd) ?? svc.childIndent + 2;
  const pad = ' '.repeat(devChildIndent);
  const rendered = [`${pad}verified:`, ...toYaml(mark, pad + '  ').split('\n')];
  const markIdx = findChildKey(lines, devIdx, devEnd, devChildIndent, 'verified');
  if (markIdx !== null) {
    const markEnd = subtreeEnd(lines, markIdx, devChildIndent, devEnd);
    lines.splice(markIdx, markEnd - markIdx + 1, ...rendered);
  } else {
    lines.splice(devEnd + 1, 0, ...rendered);
  }
  return lines.join('\n');
}

const LOCK_STALE_MS = 30000;

function acquireLock(lockPath) {
  try {
    writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function lockIsFresh(lockPath) {
  try {
    return Date.now() - statSync(lockPath).mtimeMs < LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function removeQuietly(path) {
  try { unlinkSync(path); } catch {}
}

function spliceInvariantViolated(originalText, nextText, service) {
  const beforeServices = (parseYamlLite(originalText) || {}).services || {};
  const afterServices = (parseYamlLite(nextText) || {}).services || {};
  for (const key of Object.keys(beforeServices)) {
    if (!(key in afterServices)) return true;
  }
  if (service !== undefined) {
    const target = afterServices[service];
    if (!target || typeof target !== 'object') return true;
    if (!target.dev || typeof target.dev !== 'object') return true;
  }
  return false;
}

export function updateRegistryFile(registryPath, mutate, { beforeWrite, rename = renameSync, service } = {}) {
  const lockPath = `${registryPath}.lock`;
  if (!acquireLock(lockPath)) {
    if (lockIsFresh(lockPath)) return { status: 'conflict' };
    removeQuietly(lockPath);
    if (!acquireLock(lockPath)) return { status: 'conflict' };
  }
  try {
    const original = readFileSync(registryPath, 'utf8');
    const mtimeBefore = statSync(registryPath).mtimeMs;
    const next = mutate(original);
    if (spliceInvariantViolated(original, next, service)) return { status: 'error', cause: 'splice_invariant' };
    if (beforeWrite) beforeWrite();
    if (statSync(registryPath).mtimeMs !== mtimeBefore) return { status: 'conflict' };
    const tmpPath = join(dirname(registryPath), `.services.yaml.tmp-${process.pid}-${Date.now()}`);
    writeFileSync(tmpPath, next);
    try {
      rename(tmpPath, registryPath);
    } catch (err) {
      removeQuietly(tmpPath);
      throw err;
    }
    return { status: 'ok' };
  } finally {
    removeQuietly(lockPath);
  }
}

export function persistBlock({ workspace, service, block }, hooks = {}) {
  const registryPath = join(workspace, 'registry', 'services.yaml');
  return updateRegistryFile(registryPath, (text) => spliceDevBlock(text, service, block), { ...hooks, service });
}

export function writeMark({ workspace, service, commit, today = () => new Date().toISOString().slice(0, 10) }, hooks = {}) {
  const registryPath = join(workspace, 'registry', 'services.yaml');
  return updateRegistryFile(registryPath, (text) => {
    const parsed = parseYamlLite(text);
    const svc = parsed && parsed.services ? parsed.services[service] : null;
    const block = svc && svc.dev ? svc.dev : null;
    if (!block) throw new Error(`service '${service}' has no dev block in the registry`);
    const mark = { date: today(), commit, block_hash: computeDevBlockHash(block) };
    return spliceVerifiedMark(text, service, mark);
  }, { ...hooks, service });
}
