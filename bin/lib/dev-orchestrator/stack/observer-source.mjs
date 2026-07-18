export function logSourceArgs({ mode, projectName, tailLines = 200 }) {
  const cmd = mode === 'exec'
    ? `docker exec ${projectName} tail -n ${tailLines} /tmp/${projectName}.dev.log 2>&1`
    : `docker logs --tail ${tailLines} ${projectName} 2>&1`;
  return ['-lc', cmd];
}
