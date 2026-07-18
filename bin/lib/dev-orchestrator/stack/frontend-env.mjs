export function rewriteFrontendEnv({ envText, envLocal, envBlank, hostByService }) {
  const desired = [];
  for (const [key, spec] of Object.entries(envLocal || {})) {
    desired.push([key, `http://localhost:${hostByService[spec.service]}${spec.suffix || ''}`]);
  }
  for (const key of envBlank || []) desired.push([key, '']);

  const managed = new Map(desired);
  const lines = envText.length ? envText.replace(/\n$/, '').split('\n') : [];
  const seen = new Set();
  const out = lines.map((line) => {
    const eq = line.indexOf('=');
    if (eq === -1) return line;
    const key = line.slice(0, eq).trim();
    if (managed.has(key)) { seen.add(key); return `${key}=${managed.get(key)}`; }
    return line;
  });
  for (const [key, value] of desired) {
    if (!seen.has(key)) out.push(`${key}=${value}`);
  }
  return out.join('\n') + '\n';
}
