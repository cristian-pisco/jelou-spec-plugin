// bin/lib/dev-orchestrator/stop.mjs
//
// Implements /jlu:stop-dev. Phase 2 version stubs out daemon-kill via a
// callback; Phase 3 will wire in the real PID-file/SIGTERM logic.

import { killWindow } from './tmux.mjs';

function windowNameFor(slug) {
  return `jlu-dev-${slug || '_global'}`;
}

export function stopDev({
  workspaceId, slug,
  runner,
  killServices = false,
  killDaemon = () => ({ killed: false })
}) {
  const daemon = killDaemon({ workspaceId, slug });
  const windowResult = { killed: false };
  if (killServices) {
    const target = windowNameFor(slug);
    killWindow({ target }, runner);
    windowResult.killed = true;
    windowResult.target = target;
  }
  return { daemon, window: windowResult };
}
