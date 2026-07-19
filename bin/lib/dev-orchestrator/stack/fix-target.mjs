export function resolveFixTarget({ service, worktreePaths, repoPath }) {
  const worktree = worktreePaths && worktreePaths[service];
  if (worktree) return { path: worktree, isWorktree: true, needsCleanGuard: false };
  return { path: repoPath, isWorktree: false, needsCleanGuard: true };
}
