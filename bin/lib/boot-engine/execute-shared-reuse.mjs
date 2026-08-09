import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { probeHttp, probeTcp } from '../dev-orchestrator/readiness.mjs';
import { LIFECYCLE_STAGES, redactDiagnostics } from '../dev-orchestrator/events.mjs';

export const DEFAULT_READY_TIMEOUT_S = 30;
const POLL_INTERVAL_MS = 500;

export function defaultRunner(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, opts);
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => { stdout += d; });
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err && err.message || err) }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function defaultProbePort(port) {
  const r = await probeTcp({ host: 'localhost', port });
  return r.ok;
}

function defaultProbeHttp(url) {
  return probeHttp({ url });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HOST_LAUNCHERS = new Set(['npm', 'make', 'shell']);

let verifyLogSeq = 0;

function escapeEre(command) {
  return String(command).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function verifyLogName(entry) {
  const raw = entry.dockerService || basename(entry.cwd || '') || 'service';
  return String(raw).replace(/[^A-Za-z0-9._-]/g, '-');
}

function containerVerifyLogPath(entry) {
  verifyLogSeq += 1;
  return `/tmp/${verifyLogName(entry)}.verify.${process.pid}.${Date.now()}.${verifyLogSeq}.log`;
}

function httpReadinessUrl(readiness) {
  return readiness.url || `http://localhost:${readiness.port}${readiness.path || '/'}`;
}

async function probeHttp2xx(readiness, deps) {
  const r = await deps.probeHttp(httpReadinessUrl(readiness));
  return Boolean(r && r.status >= 200 && r.status < 300);
}

async function runningComposeServices(entry, runner) {
  const r = await runner('docker', composeArgs(entry, ['-f', entry.composeFile, 'ps', '--services', '--status', 'running']), { cwd: entry.cwd });
  if (r.code !== 0) return [];
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

function composeArgs(entry, args) {
  const environmentFiles = (entry.environmentFiles || []).flatMap((path) => ['--env-file', path]);
  return ['compose', ...environmentFiles, ...args];
}

function readOverlayEnvironment(entry, readEnvironmentFile) {
  const values = {};
  for (const path of entry.environmentFiles || []) {
    for (const line of String(readEnvironmentFile(path)).split('\n')) {
      if (!line || line.trimStart().startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      values[line.slice(0, separator).trim()] = line.slice(separator + 1);
    }
  }
  return values;
}

async function probeAlreadyServing(entry, deps) {
  const { runner, probePort } = deps;
  if (entry.launcher === 'docker' || entry.launcher === 'docker-exec') {
    const running = await runningComposeServices(entry, runner);
    if (!running.includes(entry.dockerService)) return false;
    if (entry.launcher === 'docker') return true;
    const pgrep = await runner('docker', composeArgs(entry, ['-f', entry.composeFile, 'exec', '-T', entry.dockerService, 'pgrep', '-f', escapeEre(entry.command)]), { cwd: entry.cwd });
    return pgrep.code === 0;
  }
  if (HOST_LAUNCHERS.has(entry.launcher)) {
    const pgrep = await runner('pgrep', ['-f', escapeEre(entry.command)], {});
    if (pgrep.code === 0) return true;
    const readiness = entry.readiness;
    if (!readiness) return false;
    if (readiness.type === 'http_200') return probeHttp2xx(readiness, deps);
    if (readiness.port) return probePort(readiness.port);
    return false;
  }
  return false;
}

function composeLogArgs(entry) {
  const logArgs = composeArgs(entry, ['-f', entry.composeFile, 'logs', '--no-color']);
  if (entry.dockerService) logArgs.push(entry.dockerService);
  return logArgs;
}

async function bootDockerFamily(entry, deps, started) {
  const { runner } = deps;
  const before = await runningComposeServices(entry, runner);
  const logArgs = composeLogArgs(entry);
  const preBootLogs = entry.launcher === 'docker'
    ? ((await runner('docker', logArgs, { cwd: entry.cwd })).stdout || '')
    : '';
  const upArgs = composeArgs(entry, ['-f', entry.composeFile, 'up', '-d']);
  if (entry.dockerService) upArgs.push(entry.dockerService);
  const up = await runner('docker', upArgs, { cwd: entry.cwd });
  if (up.code !== 0) {
    return { error: `up_failed: ${(up.stderr || up.stdout || '').trim()}`, commandExecuted: false, readLogs: async () => '' };
  }
  const after = await runningComposeServices(entry, runner);
  for (const svc of after) {
    if (!before.includes(svc)) started.containers.push(svc);
  }
  if (entry.launcher === 'docker') {
    return {
      commandExecuted: started.containers.length > 0,
      readLogs: async () => {
        const current = (await runner('docker', logArgs, { cwd: entry.cwd })).stdout || '';
        if (current.length < preBootLogs.length) return current;
        return current.slice(preBootLogs.length);
      },
    };
  }
  const logPath = containerVerifyLogPath(entry);
  const environmentArgs = Object.entries(readOverlayEnvironment(entry, deps.readEnvironmentFile)).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  const exec = await runner('docker', composeArgs(entry, ['-f', entry.composeFile, 'exec', '-T', ...environmentArgs, entry.dockerService, 'sh', '-lc', `${entry.command} > ${logPath} 2>&1 &`]), { cwd: entry.cwd });
  if (exec.code !== 0) {
    return { error: `exec_failed: ${(exec.stderr || exec.stdout || '').trim()}`, commandExecuted: false, readLogs: async () => '' };
  }
  started.processes.push({ kind: 'docker-exec', service: entry.dockerService, command: entry.command });
  return {
    commandExecuted: true,
    readLogs: async () => (await runner('docker', composeArgs(entry, ['-f', entry.composeFile, 'exec', '-T', entry.dockerService, 'sh', '-lc', `cat ${logPath} 2>/dev/null || true`]), { cwd: entry.cwd })).stdout,
  };
}

async function bootHost(entry, deps, started) {
  const { runner } = deps;
  const logDir = mkdtempSync(join(tmpdir(), 'jlu-verify-'));
  const logPath = join(logDir, `${verifyLogName(entry)}.verify.log`);
  const environment = { ...process.env, ...readOverlayEnvironment(entry, deps.readEnvironmentFile) };
  const launch = await runner('sh', ['-c', `setsid ${entry.command} > ${logPath} 2>&1 & echo $!`], { cwd: entry.cwd, env: environment });
  if (launch.code !== 0) {
    return { error: `spawn_failed: ${(launch.stderr || launch.stdout || '').trim()}`, commandExecuted: false, logDir, readLogs: async () => '' };
  }
  const pid = launch.stdout.trim();
  started.processes.push({ kind: 'host', pid, command: entry.command });
  return {
    commandExecuted: true,
    logDir,
    readLogs: async () => (await runner('sh', ['-c', `cat ${logPath} 2>/dev/null || true`], {})).stdout,
  };
}

async function restartServing(entry, deps) {
  if (entry.launcher === 'docker') {
    const args = composeArgs(entry, ['-f', entry.composeFile, 'up', '-d', '--force-recreate']);
    if (entry.dockerService) args.push(entry.dockerService);
    const restarted = await deps.runner('docker', args, { cwd: entry.cwd });
    if (restarted.code !== 0) return { error: `restart_failed: ${(restarted.stderr || restarted.stdout || '').trim()}`, commandExecuted: false, readLogs: async () => '' };
    const logArgs = composeLogArgs(entry);
    return { commandExecuted: true, readLogs: async () => (await deps.runner('docker', logArgs, { cwd: entry.cwd })).stdout || '' };
  }
  if (!entry.teardownCmd) return { error: 'restart_required_but_no_teardown', commandExecuted: false, readLogs: async () => '' };
  const stopped = await deps.runner('sh', ['-c', entry.teardownCmd], { cwd: entry.cwd });
  if (stopped.code !== 0) return { error: `restart_failed: ${(stopped.stderr || stopped.stdout || '').trim()}`, commandExecuted: false, readLogs: async () => '' };
  return null;
}

async function readinessCheckOnce(readiness, deps, readLogs, pattern) {
  if (readiness.type === 'stdout_match') {
    const text = await readLogs();
    return pattern.test(text || '');
  }
  if (readiness.type === 'port_open') {
    return deps.probePort(readiness.port);
  }
  if (readiness.type === 'http_200') {
    return probeHttp2xx(readiness, deps);
  }
  return false;
}

async function pollReadiness(entry, deps, readLogs) {
  const readiness = entry.readiness;
  if (!readiness || !readiness.type) return { ok: false, cause: 'missing_ready_signal' };
  let pattern = null;
  if (readiness.type === 'stdout_match') {
    try {
      pattern = new RegExp(readiness.pattern);
    } catch {
      return { ok: false, cause: 'bad_ready_pattern' };
    }
  }
  const timeoutMs = (entry.readyTimeoutS ?? DEFAULT_READY_TIMEOUT_S) * 1000;
  const intervalMs = deps.pollIntervalMs;
  const startedAt = deps.now();
  for (let ticks = intervalMs; ; ticks += intervalMs) {
    if (await readinessCheckOnce(readiness, deps, readLogs, pattern)) return { ok: true };
    if (Math.max(deps.now() - startedAt, ticks) >= timeoutMs) return { ok: false, cause: 'ready_timeout' };
    await deps.sleep(intervalMs);
  }
}

const ERROR_HINT_RE = /(err[a-z_]*|error|exception|fatal|panic|traceback|cannot find|not found|refused|denied|unavailable|missing|failed|timed out|eaddrinuse|econnrefused|enotfound|exited with)/i;
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HINT_LIMIT = 3;
const HINT_WIDTH = 200;

export function errorHints(logText, { max = HINT_LIMIT, width = HINT_WIDTH } = {}) {
  const lines = String(logText || '')
    .split('\n')
    .map((line) => line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim())
    .filter((line) => line && !ENV_ASSIGNMENT_RE.test(line) && ERROR_HINT_RE.test(line));
  return lines.slice(-max).map((line) => {
    const redacted = redactDiagnostics(line);
    return redacted.length > width ? `${redacted.slice(0, width)}…` : redacted;
  });
}

async function restoreToFound(entry, deps, started) {
  const { runner } = deps;
  let clean = true;
  for (const proc of started.processes) {
    if (proc.kind === 'host') {
      const groupKill = await runner('sh', ['-c', `kill -- -${proc.pid}`], {});
      if (groupKill.code !== 0) {
        const plainKill = await runner('sh', ['-c', `kill ${proc.pid}`], {});
        if (plainKill.code !== 0) clean = false;
      }
    } else if (proc.kind === 'docker-exec') {
      if (entry.teardownCmd) {
        const r = await runner('sh', ['-c', entry.teardownCmd], { cwd: entry.cwd });
        if (r.code !== 0) clean = false;
      } else if (!started.containers.includes(proc.service)) {
        clean = false;
      }
    }
  }
  if (started.containers.length > 0) {
    const r = await runner('docker', composeArgs(entry, ['-f', entry.composeFile, 'stop', ...started.containers]), { cwd: entry.cwd });
    if (r.code !== 0) clean = false;
  }
  return clean;
}

function removeHostLogDir(logDir) {
  try {
    rmSync(logDir, { recursive: true, force: true });
  } catch {
  }
}

export async function verifySharedReuse(entry, {
  runner = defaultRunner,
  probePort = defaultProbePort,
  probeHttp: probeHttpFn = defaultProbeHttp,
  sleep = defaultSleep,
  pollIntervalMs = POLL_INTERVAL_MS,
  now = Date.now,
  readEnvironmentFile = (path) => readFileSync(path, 'utf8'),
  onLifecycle = () => {},
} = {}) {
  const deps = { runner, probePort, probeHttp: probeHttpFn, sleep, pollIntervalMs, now, readEnvironmentFile };
  const started = { containers: [], processes: [] };

  const alreadyServing = await probeAlreadyServing(entry, deps);
  if (alreadyServing && !entry.restartRequired) {
    onLifecycle({ stage: LIFECYCLE_STAGES.boot, outcome: 'reused' });
    return { status: 'green-preexisting', cause: null, readiness_ms: 0, command_executed: false, started, teardown_clean: true, error_hints: [] };
  }

  onLifecycle({ stage: LIFECYCLE_STAGES.boot, outcome: 'started' });
  let commandExecuted = false;
  let outcome;
  let teardownClean = true;
  let hostLogDir = null;
  let hints = [];
  try {
    const restarted = alreadyServing && entry.restartRequired ? await restartServing(entry, deps) : null;
    const boot = restarted || (HOST_LAUNCHERS.has(entry.launcher)
      ? await bootHost(entry, deps, started)
      : await bootDockerFamily(entry, deps, started));
    hostLogDir = boot.logDir || null;
    commandExecuted = boot.commandExecuted;
    if (boot.error) {
      outcome = { status: 'failed', cause: boot.error, readiness_ms: 0 };
    } else {
      const t0 = now();
      const readiness = await pollReadiness(entry, deps, boot.readLogs);
      const readinessMs = now() - t0;
      if (readiness.cause === 'ready_timeout') hints = errorHints(await boot.readLogs());
      outcome = readiness.ok
        ? { status: 'green', cause: null, readiness_ms: readinessMs }
        : { status: 'failed', cause: readiness.cause, readiness_ms: readinessMs };
    }
    onLifecycle({ stage: LIFECYCLE_STAGES.boot, outcome: outcome.status === 'green' ? 'succeeded' : 'failed', cause: outcome.cause });
  } finally {
    const ownsResources = started.containers.length > 0 || started.processes.length > 0;
    if (ownsResources) onLifecycle({ stage: LIFECYCLE_STAGES.cleanup, outcome: 'started' });
    teardownClean = await restoreToFound(entry, deps, started);
    if (ownsResources) onLifecycle({ stage: LIFECYCLE_STAGES.cleanup, outcome: teardownClean ? 'succeeded' : 'failed' });
    if (hostLogDir) removeHostLogDir(hostLogDir);
  }
  return { ...outcome, command_executed: commandExecuted, started, teardown_clean: teardownClean, error_hints: hints };
}
