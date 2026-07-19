export function backendEnvBackupPlan({ services, worktreePaths, backupName, envFileName = '.env' }) {
  const wt = worktreePaths || {};
  const out = [];
  for (const svc of (services || [])) {
    if (wt[svc.name]) continue;
    out.push({ service: svc.name, path: `${svc.path}/${envFileName}`, backupPath: `${svc.path}/${backupName}` });
  }
  return out;
}
