export function logSourceArgs({ mode, projectName, tailLines = 200 }) {
  if (mode === 'exec') {
    return ['exec', projectName, 'tail', '-n', String(tailLines), `/tmp/${projectName}.dev.log`];
  }
  return ['logs', '--tail', String(tailLines), projectName];
}
