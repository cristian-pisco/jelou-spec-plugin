export function pidsToKill(state) {
  const seen = new Set();
  const out = [];
  for (const h of (state.hostPids || [])) {
    const pid = Number(h.pid);
    if (Number.isInteger(pid) && pid > 0 && !seen.has(pid)) {
      seen.add(pid);
      out.push(pid);
    }
  }
  return out;
}

export function restorePlan(state) {
  const fe = state.frontendEnv;
  const frontend = fe && fe.envBackup
    ? { from: `${fe.path}/${fe.envBackup}`, to: `${fe.path}/${fe.envFile}` }
    : null;
  const backend = (state.backendEnvBackups || []).map((b) => ({ from: b.backupPath, to: b.path }));
  return { frontend, backend };
}

function completeMarker(marker) {
  return marker && ['workspaceId', 'taskSlug', 'runId'].every((field) => typeof marker[field] === 'string' && marker[field].length > 0);
}

function markerMatches(left, right) {
  return left.workspaceId === right.workspaceId && left.taskSlug === right.taskSlug && left.runId === right.runId;
}

function refusedEntry(entry, reason) {
  return { kind: entry.kind, resource: entry.resource, reason };
}

export function ownedCleanupPlan(state, identity) {
  const original = state.mutationJournal || [];
  const journal = [...original].reverse();
  if (!completeMarker(identity) || !completeMarker(state.currentRun)) {
    return { actions: [], refused: journal.map((entry) => refusedEntry(entry, 'current-run-marker-missing')), retained: [...original] };
  }
  if (!markerMatches(state.currentRun, identity)) {
    return { actions: [], refused: journal.map((entry) => refusedEntry(entry, 'current-run-marker-mismatch')), retained: [...original] };
  }
  const actions = [];
  const refused = [];
  const retained = [];
  for (const entry of journal) {
    if (!completeMarker(entry.marker)) {
      refused.push(refusedEntry(entry, 'ownership-marker-missing'));
      retained.unshift(entry);
    } else if (!markerMatches(entry.marker, identity)) {
      refused.push(refusedEntry(entry, 'ownership-marker-mismatch'));
      retained.unshift(entry);
    }
    else actions.push(entry);
  }
  return { actions, refused, retained };
}
