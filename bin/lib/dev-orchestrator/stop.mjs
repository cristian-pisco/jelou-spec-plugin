// bin/lib/dev-orchestrator/stop.mjs
//
// Implements /jlu:stop-dev. Default daemon-kill is the real one from
// daemon-spawn.mjs; tests inject a fake.

import { killWindow } from './tmux.mjs';
import { killDaemon as realKillDaemon } from './daemon-spawn.mjs';
import { truncateEventsLog } from './state-daemon.mjs';

function windowNameFor(slug) {
  return `jlu-dev-${slug || '_global'}`;
}

export function stopDev({
  workspaceId, slug,
  runner,
  killServices = false,
  killDaemon = realKillDaemon
}) {
  const daemon = killDaemon({ workspaceId, slug });
  truncateEventsLog({ workspaceId, slug });
  const windowResult = { killed: false };
  if (killServices) {
    const target = windowNameFor(slug);
    killWindow({ target }, runner);
    windowResult.killed = true;
    windowResult.target = target;
  }
  return { daemon, window: windowResult };
}
