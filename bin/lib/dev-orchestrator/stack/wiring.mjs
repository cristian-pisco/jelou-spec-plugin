export function wireEnv({ envText, peers, slug, peerInternalPort }) {
  const targets = new Map();
  for (const [target, envVar] of Object.entries(peers || {})) {
    const port = peerInternalPort[target];
    targets.set(envVar, `http://${target}-${slug}:${port}`);
  }
  const out = envText.split('\n').map((line) => {
    const eq = line.indexOf('=');
    if (eq === -1) return line;
    const key = line.slice(0, eq).trim();
    if (targets.has(key)) return `${key}=${targets.get(key)}`;
    return line;
  });
  return out.join('\n');
}
