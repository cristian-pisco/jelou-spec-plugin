import { spawnSync } from 'node:child_process';
import { compilePatterns, Cooldown } from '../patterns-matcher.mjs';
import { effectiveFailurePatterns } from '../config.mjs';
import { appendEvent } from '../events.mjs';
import { notifyOs } from '../notify.mjs';
import { eventsLogPath } from '../state-daemon.mjs';
import { logSourceArgs } from './observer-source.mjs';
import { observeTick } from './observer.mjs';

export function buildObserverServices(plan, { tailLines = 200 } = {}) {
  return plan.map((entry) => ({ name: entry.name, args: logSourceArgs({ mode: entry.mode, projectName: entry.projectName, tailLines }) }));
}

export function runObserverPass({ plan, config, workspaceId, slug, run = (args) => spawnSync('docker', args, { encoding: 'utf8' }), cooldown, notifier, prevCaptures = {}, appendEventFn = appendEvent }) {
  const services = buildObserverServices(plan);
  const compiledByService = {};
  for (const entry of plan) {
    const svc = (config.services || []).find((s) => s.name === entry.name) || {};
    compiledByService[entry.name] = compilePatterns(effectiveFailurePatterns(config, svc));
  }
  const logPath = eventsLogPath({ workspaceId, slug });
  const onMatch = ({ service, pattern, line }) => {
    appendEventFn(logPath, { type: 'pattern_match', slug, service, pattern, line });
    const key = `${service}:soft`;
    if (cooldown.allow(key)) {
      notifyOs({ title: `jlu-dev: ${service} log error`, body: `${pattern} — Run /jlu-diagnose ${service}`, urgency: 'normal', runner: notifier });
    }
  };
  observeTick({ services, run, compiledByService, prevCaptures, onMatch });
  return { services: services.map((s) => s.name) };
}

export { Cooldown };
