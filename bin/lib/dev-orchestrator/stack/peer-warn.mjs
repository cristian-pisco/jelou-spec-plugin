export function missingPeerVars({ envText, peers }) {
  const present = new Set();
  for (const line of String(envText || '').split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    present.add(line.slice(0, eq).trim());
  }
  const missing = [];
  for (const envVar of Object.values(peers || {})) {
    if (!present.has(envVar)) missing.push(envVar);
  }
  return missing;
}
