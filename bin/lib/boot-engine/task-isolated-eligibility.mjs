export function partitionBootOrder({ services, worktreePaths, unifiedRegistryIds }) {
  const eligible = [];
  const passthrough = [];
  const warnWorktreeNotIsolated = [];
  for (const svc of services) {
    const isDockerExec = svc.dev && svc.dev.launcher === 'docker-exec';
    const hasWorktree = !!worktreePaths[svc.id];
    const inRegistry = unifiedRegistryIds.has(svc.id);
    if (isDockerExec && hasWorktree && inRegistry) eligible.push(svc.id);
    else if (isDockerExec && hasWorktree && !inRegistry) warnWorktreeNotIsolated.push(svc.id);
    else passthrough.push(svc.id);
  }
  return { eligible, passthrough, warnWorktreeNotIsolated };
}
