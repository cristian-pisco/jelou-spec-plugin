// bin/lib/dev-orchestrator/stop.mjs
//
// Implements /jlu:stop-dev. Default daemon-kill is the real one from
// daemon-spawn.mjs; tests inject a fake.

import { killWindow } from './tmux.mjs';
import { killDaemon as realKillDaemon } from './daemon-spawn.mjs';
import { truncateEventsLog } from './state-daemon.mjs';
import { tearDownStack as realTearDownStack } from './stack/stack-teardown.mjs';
import { LIFECYCLE_STAGES } from './events.mjs';

function windowNameFor(slug) {
  return `jlu-dev-${slug || '_global'}`;
}

export function stopDev({
  workspaceId, slug, runId,
  runner,
  killServices = false,
  killDaemon = realKillDaemon,
  tearDownStack = realTearDownStack,
  onLifecycle = () => {}
}) {
  const daemon = killDaemon({ workspaceId, slug });
  const teardownOptions = { workspaceId, slug };
  if (runId) teardownOptions.runId = runId;
  const stack = tearDownStack(teardownOptions);
  truncateEventsLog({ workspaceId, slug });
  onLifecycle({ stage: LIFECYCLE_STAGES.cleanup, outcome: (stack.refused || []).length === 0 ? 'succeeded' : 'refused', taskSlug: slug });
  const windowResult = { killed: false };
  if (killServices) {
    const target = windowNameFor(slug);
    killWindow({ target }, runner);
    windowResult.killed = true;
    windowResult.target = target;
  }
  return { daemon, stack, window: windowResult };
}
