export function baseImageArgs({ composeFile, composeService }) {
  return ['compose', '-f', composeFile, 'config', '--images', composeService];
}

export function resolveBaseImage({ cwd, composeFile, composeService, run }) {
  const r = run('docker', baseImageArgs({ composeFile, composeService }), { cwd });
  if (!r || r.status !== 0) return null;
  const line = String(r.stdout || '').split('\n').map((s) => s.trim()).find((s) => s.length > 0);
  return line || null;
}
