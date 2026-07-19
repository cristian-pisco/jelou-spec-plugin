export function readinessPollUrl({ readiness, host }) {
  if (!readiness) return null;
  if (readiness.type === 'http_200') return `http://localhost:${host}${readiness.path || '/'}`;
  if (readiness.type === 'port_open') return `http://localhost:${host}/`;
  return null;
}
