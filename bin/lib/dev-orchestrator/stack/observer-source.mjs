const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function guard(id) {
  if (!SAFE_NAME.test(id)) throw new Error(`unsafe identifier for docker log source: ${JSON.stringify(id)}`);
  return id;
}

export function logSourceArgs({ mode, logMode, projectName, container, tailLines = 200 }) {
  const effective = logMode || (mode === 'exec' ? 'exec-file' : 'docker-logs');
  if (effective === 'exec-file') {
    const name = guard(projectName);
    return ['exec', name, 'tail', '-n', String(tailLines), `/tmp/${name}.dev.log`];
  }
  return ['logs', '--tail', String(tailLines), guard(container || projectName)];
}
