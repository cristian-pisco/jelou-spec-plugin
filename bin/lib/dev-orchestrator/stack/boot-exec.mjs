export function bootService({ plan, writeFile, run }) {
  for (const f of plan.files) writeFile(f.path, f.content);
  const results = [];
  for (const args of plan.commands) {
    results.push(run('docker', args, { cwd: plan.cwd }));
  }
  return { projectName: plan.projectName, results };
}
