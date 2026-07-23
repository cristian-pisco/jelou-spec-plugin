#!/usr/bin/env node

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYamlLite } from './lib/registry/yaml-lite.mjs';
import {
  computeDevBlockHash,
  lineIndent,
  persistBlock,
  spliceDevBlock,
  spliceVerifiedMark,
  updateRegistryFile,
  writeMark,
} from './lib/registry/splice.mjs';
import { DEFAULT_READY_TIMEOUT_S, defaultRunner, verifySharedReuse } from './lib/boot-engine/execute-shared-reuse.mjs';

export const EXIT_CODES = { green: 0, error: 2, 'green-preexisting': 3, failed: 4, conflict: 5 };

export { computeDevBlockHash, persistBlock, spliceDevBlock, spliceVerifiedMark, updateRegistryFile, writeMark };


export function composeEnvFiles(composeText) {
  const out = [];
  const lines = String(composeText || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*env_file:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = m[1].replace(/\s+#.*$/, '').trim();
    if (inline !== '' && !inline.startsWith('#')) {
      if (inline.startsWith('[') && inline.endsWith(']')) {
        for (const part of inline.slice(1, -1).split(',')) {
          const v = stripScalarQuotes(part.trim());
          if (v) out.push({ path: v, required: true });
        }
      } else {
        out.push({ path: stripScalarQuotes(inline), required: true });
      }
      continue;
    }
    const baseIndent = lineIndent(lines[i]);
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') break;
      if (lineIndent(lines[j]) <= baseIndent) break;
      const item = /^\s*-\s*(.+)$/.exec(lines[j]);
      if (item) {
        const content = item[1].replace(/\s+#.*$/, '').trim();
        const pathForm = /^path:\s*(.*)$/.exec(content);
        out.push({ path: stripScalarQuotes(pathForm ? pathForm[1].trim() : content), required: true });
        continue;
      }
      const attr = /^\s*required:\s*(\S+)/.exec(lines[j]);
      if (attr && out.length > 0) {
        out[out.length - 1].required = attr[1] !== 'false';
        continue;
      }
      break;
    }
  }
  return out;
}

export function composeBuildTargets(composeText) {
  const out = [];
  const lines = String(composeText || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*build:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = m[1].replace(/\s+#.*$/, '').trim();
    if (inline !== '' && !inline.startsWith('#')) {
      out.push({ context: stripScalarQuotes(inline), dockerfile: 'Dockerfile' });
      continue;
    }
    const baseIndent = lineIndent(lines[i]);
    const target = { context: '.', dockerfile: 'Dockerfile' };
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') break;
      if (lineIndent(lines[j]) <= baseIndent) break;
      const kv = /^\s*(context|dockerfile):\s*(.+)$/.exec(lines[j]);
      if (!kv) continue;
      target[kv[1]] = stripScalarQuotes(kv[2].replace(/\s+#.*$/, '').trim());
    }
    out.push(target);
  }
  return out;
}

function stripScalarQuotes(s) {
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

const PACKAGE_MANAGER_COMMAND_RE = /^(npm|yarn|pnpm|bun)\b/;
const HOST_LAUNCHERS = new Set(['npm', 'make', 'shell']);

export function structuralPreflight(block, checkout, svc = {}) {
  const docker = block.docker || svc.docker || {};
  if (block.launcher === 'docker' || block.launcher === 'docker-exec') {
    if (!docker.compose_file) return 'compose_file not declared for a docker launcher';
    const composePath = join(checkout, docker.compose_file);
    if (!existsSync(composePath)) return `compose file missing in checkout: ${docker.compose_file}`;
    const composeDir = dirname(composePath);
    let composeText = '';
    try { composeText = readFileSync(composePath, 'utf8'); } catch { composeText = ''; }
    for (const ref of composeEnvFiles(composeText)) {
      if (ref.required === false) continue;
      if (ref.path.includes('$')) continue;
      if (!existsSync(join(composeDir, ref.path))) {
        return `env_file referenced by ${docker.compose_file} missing in checkout: ${ref.path}`;
      }
    }
    for (const target of composeBuildTargets(composeText)) {
      if (target.context.includes('$') || target.dockerfile.includes('$')) continue;
      const rel = join(target.context, target.dockerfile);
      if (!existsSync(join(composeDir, rel))) return `dockerfile ${rel} missing`;
    }
  }
  if (HOST_LAUNCHERS.has(block.launcher) && typeof block.command === 'string' && PACKAGE_MANAGER_COMMAND_RE.test(block.command.trim())) {
    if (!existsSync(join(checkout, 'node_modules'))) {
      return `node_modules missing in checkout for command '${block.command}'`;
    }
  }
  const readiness = block.ready_signal;
  if (!block.health_url && (!readiness || !readiness.type)) return 'missing_ready_signal';
  return null;
}

export function buildVerifyEntry(block, svc, checkout) {
  const docker = block.docker || (svc && svc.docker) || {};
  const readiness = block.ready_signal
    ? { ...block.ready_signal }
    : block.health_url
      ? { type: 'http_200', url: block.health_url }
      : null;
  return {
    cwd: checkout,
    launcher: block.launcher,
    command: block.command || null,
    composeFile: docker.compose_file || null,
    dockerService: docker.service || null,
    readiness,
    readyTimeoutS: block.ready_timeout_s ?? DEFAULT_READY_TIMEOUT_S,
    teardownCmd: block.teardown || null,
  };
}

function readRegistry(workspace) {
  const registryPath = join(workspace, 'registry', 'services.yaml');
  const text = readFileSync(registryPath, 'utf8');
  return { registryPath, text, parsed: parseYamlLite(text) };
}

function serviceBlock(parsed, serviceId) {
  const svc = parsed && parsed.services ? parsed.services[serviceId] : null;
  return { svc, block: svc && svc.dev ? svc.dev : null };
}

async function gitShortHead(checkout, runner) {
  const r = await runner('git', ['-C', checkout, 'rev-parse', '--short', 'HEAD'], {});
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function runVerify({ workspace, service, checkout, runner = defaultRunner, probes = {} }) {
  const { parsed } = readRegistry(workspace);
  const { svc, block } = serviceBlock(parsed, service);
  if (!block) return { error: `service '${service}' has no dev block in the registry` };
  const blockHash = computeDevBlockHash(block);
  const commit = await gitShortHead(checkout, runner);
  const preflightCause = structuralPreflight(block, checkout, svc);
  if (preflightCause) {
    return {
      verdict: {
        status: 'failed',
        cause: preflightCause,
        readiness_ms: 0,
        commit,
        command_executed: false,
        teardown_clean: true,
        block_hash: blockHash,
      },
    };
  }
  const entry = buildVerifyEntry(block, svc, checkout);
  const result = await verifySharedReuse(entry, { runner, ...probes });
  const status = result.status === 'green' && result.command_executed === false ? 'green-preexisting' : result.status;
  return {
    verdict: {
      status,
      cause: result.cause,
      readiness_ms: result.readiness_ms,
      commit,
      command_executed: result.command_executed,
      teardown_clean: result.teardown_clean,
      block_hash: blockHash,
    },
  };
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--workspace') out.workspace = argv[++i];
    else if (a === '--service') out.service = argv[++i];
    else if (a === '--checkout') out.checkout = argv[++i];
    else if (a === '--hash') out.hash = true;
    else if (a === '--persist-block') out.persistBlock = true;
    else if (a === '--block-file') out.blockFile = argv[++i];
    else if (a === '--write-mark') out.writeMark = true;
    else if (a === '--commit') out.commit = argv[++i];
  }
  return out;
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function fail(message) {
  emit({ error: message });
  process.exit(EXIT_CODES.error);
}

const BLOCK_LAUNCHERS = ['docker', 'docker-exec', 'npm', 'make', 'shell'];

function isScalarValue(value) {
  const t = typeof value;
  return t === 'string' || t === 'number' || t === 'boolean';
}

function isRenderableValue(value) {
  if (isScalarValue(value)) return true;
  if (Array.isArray(value)) return value.every(isScalarValue);
  if (value && typeof value === 'object') return Object.values(value).every(isRenderableValue);
  return false;
}

function hasControlChars(value) {
  if (typeof value === 'string') return /[\n\r\t]/.test(value);
  if (Array.isArray(value)) return value.some(hasControlChars);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => /[\n\r\t]/.test(k) || hasControlChars(v));
  }
  return false;
}

export function validateBlockShape(block) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return 'block must be a JSON object';
  if (!BLOCK_LAUNCHERS.includes(block.launcher)) return `launcher must be one of ${BLOCK_LAUNCHERS.join('|')}`;
  if (block.launcher !== 'docker' && typeof block.command !== 'string') {
    return `command is required when launcher is '${block.launcher}'`;
  }
  for (const [key, value] of Object.entries(block)) {
    if (!isRenderableValue(value)) return `unsupported value type for key '${key}'`;
  }
  if (hasControlChars(block)) return 'control characters are not allowed in block strings';
  return null;
}

function readBlockFile(blockFile) {
  const raw = blockFile === '-' ? readFileSync(0, 'utf8') : readFileSync(blockFile, 'utf8');
  const block = JSON.parse(raw);
  const cause = validateBlockShape(block);
  if (cause) fail(cause);
  return block;
}

function updateExitCode(result) {
  if (result.status === 'ok') return EXIT_CODES.green;
  if (result.status === 'conflict') return EXIT_CODES.conflict;
  return EXIT_CODES.error;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.workspace || !args.service) {
    fail('usage: verify-dev-block.mjs --workspace <ws> --service <id> [--checkout <dir> | --hash | --persist-block --block-file <path|-> | --write-mark --commit <shortsha>]');
  }
  if (args.hash) {
    const { parsed } = readRegistry(args.workspace);
    const { block } = serviceBlock(parsed, args.service);
    if (!block) fail(`service '${args.service}' has no dev block in the registry`);
    emit({ block_hash: computeDevBlockHash(block) });
    process.exit(EXIT_CODES.green);
  }
  if (args.persistBlock) {
    if (!args.blockFile) fail('--persist-block requires --block-file <path|->');
    const block = readBlockFile(args.blockFile);
    const result = persistBlock({ workspace: args.workspace, service: args.service, block });
    emit(result);
    process.exit(updateExitCode(result));
  }
  if (args.writeMark) {
    if (!args.commit || args.commit === '-') fail('--write-mark requires --commit <shortsha>');
    const result = writeMark({ workspace: args.workspace, service: args.service, commit: args.commit });
    emit(result);
    process.exit(updateExitCode(result));
  }
  if (!args.checkout) {
    fail('verify mode requires --checkout <dir>');
  }
  const { verdict, error } = await runVerify({
    workspace: args.workspace,
    service: args.service,
    checkout: args.checkout,
  });
  if (error) fail(error);
  emit(verdict);
  process.exit(EXIT_CODES[verdict.status] ?? EXIT_CODES.error);
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main().catch((err) => {
    emit({ error: String(err && err.message || err) });
    process.exit(EXIT_CODES.error);
  });
}
