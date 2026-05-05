// bin/lib/dev-orchestrator/patterns.mjs
//
// Core of /jlu:add-failure-pattern. Read JSON, append regex (deduped),
// validate compilability, atomic-write, optionally signal daemon.

import { readConfig, writeConfigAtomic } from './config.mjs';
import { readPid } from './state-daemon.mjs';

export function addPattern({ configPath, serviceName, pattern }) {
  const cfg = readConfig(configPath);
  const services = cfg.services || [];
  const idx = services.findIndex((s) => s.name === serviceName);
  if (idx === -1) return { updated: false, reason: `service not found: ${serviceName}` };

  try { new RegExp(pattern, 'i'); }
  catch (e) { return { updated: false, reason: `regex error: ${e.message}` }; }

  const existing = services[idx].log_failure_patterns || [];
  if (existing.includes(pattern)) return { updated: false, reason: 'duplicate' };

  const next = {
    ...cfg,
    services: services.map((s, i) =>
      i === idx ? { ...s, log_failure_patterns: [...existing, pattern] } : s
    )
  };
  writeConfigAtomic(configPath, next);
  return { updated: true };
}

export function signalDaemon({ workspaceId, slug, baseDir, signal = 'SIGHUP', killer = process.kill.bind(process) }) {
  const pid = readPid({ workspaceId, slug, baseDir });
  if (!pid) return { signaled: false };
  try { killer(pid, signal); return { signaled: true, pid }; }
  catch (e) { return { signaled: false, error: e.message }; }
}
