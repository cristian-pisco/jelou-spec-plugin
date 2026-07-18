export function readinessPollUrl(entry) {
  const primary = entry.ports.find(p => p.primary) || entry.ports[0];
  const parsed = new URL(entry.readiness.url);
  return `http://localhost:${primary.host}${parsed.pathname}${parsed.search}`;
}
