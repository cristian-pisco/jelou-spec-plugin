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
