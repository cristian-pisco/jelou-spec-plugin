const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

export function logSourceArgs({ mode, projectName, tailLines = 200 }) {
  if (!SAFE_NAME.test(projectName)) throw new Error(`unsafe projectName for docker log source: ${JSON.stringify(projectName)}`);
  if (mode === 'exec') {
    return ['exec', projectName, 'tail', '-n', String(tailLines), `/tmp/${projectName}.dev.log`];
  }
  return ['logs', '--tail', String(tailLines), projectName];
}
