export function composeUpArgs({ projectName, composeFile, overrideFile }) {
  return ['compose', '-p', projectName, '-f', composeFile, '-f', overrideFile, 'up', '-d'];
}

export function execAppArgs({ containerName, command, logPath }) {
  return ['exec', '-d', containerName, 'sh', '-lc', `cd /app && ${command} > ${logPath} 2>&1`];
}

export function bootPlan(entry, options = {}) {
  const overrideFileName = options.overrideFileName || 'docker-compose.jlu.yml';
  const envFileName = options.envFileName || '.env';
  const files = [
    { path: `${entry.cwd}/${overrideFileName}`, content: entry.overrideYaml },
    { path: `${entry.cwd}/${envFileName}`, content: entry.wiredEnv }
  ];
  const commands = [composeUpArgs({ projectName: entry.projectName, composeFile: entry.composeFile, overrideFile: overrideFileName })];
  if (entry.mode === 'exec') {
    commands.push(execAppArgs({ containerName: entry.projectName, command: entry.command, logPath: `/tmp/${entry.projectName}.dev.log` }));
  }
  return { projectName: entry.projectName, cwd: entry.cwd, files, commands };
}
