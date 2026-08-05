export function composeMountsArgs({ composeFile }) {
  return ['compose', '-f', composeFile, 'config', '--format', 'json'];
}

function extractMounts(config, composeService) {
  const service = config?.services?.[composeService];
  if (!service || !Array.isArray(service.volumes)) return null;
  return service.volumes
    .filter((v) => v && typeof v.target === 'string')
    .map((v) => ({ type: v.type || null, target: v.target, source: v.source ?? null }));
}

export function resolveComposeMounts({ cwd, composeFile, composeService, run }) {
  const r = run('docker', composeMountsArgs({ composeFile }), { cwd });
  if (!r || r.status !== 0) return null;
  try {
    return extractMounts(JSON.parse(String(r.stdout || '')), composeService);
  } catch {
    return null;
  }
}
