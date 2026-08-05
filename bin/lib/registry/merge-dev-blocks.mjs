function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function overlayDev(baseDev, overlayDev) {
  const out = { ...(baseDev || {}) };
  for (const [k, v] of Object.entries(overlayDev || {})) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? { ...out[k], ...v } : v;
  }
  return out;
}

export function mergeDevBlocks({ baseServices, overlayServices, resolve }) {
  const byPath = new Map();
  for (const [id, svc] of Object.entries(overlayServices || {})) {
    if (!svc || !svc.path) continue;
    byPath.set(resolve(svc.path), { id, svc });
  }

  const services = {};
  const merged = [];
  const matchedPaths = new Set();

  for (const [id, svc] of Object.entries(baseServices || {})) {
    const key = svc && svc.path ? resolve(svc.path) : null;
    const hit = key ? byPath.get(key) : null;
    if (!hit || !hit.svc.dev) {
      services[id] = svc;
      continue;
    }
    matchedPaths.add(key);
    const dev = overlayDev(svc.dev, hit.svc.dev);
    services[id] = { ...svc, dev };
    const changes = Object.keys(hit.svc.dev)
      .filter((k) => !isPlainObject(dev[k]) && (svc.dev || {})[k] !== dev[k])
      .map((k) => ({ field: k, from: (svc.dev || {})[k] ?? null, to: dev[k] }));
    merged.push({ id, from: hit.id, fields: Object.keys(hit.svc.dev), changes });
  }

  const unmerged = [];
  for (const [key, { id, svc }] of byPath.entries()) {
    if (!matchedPaths.has(key) && svc.dev) unmerged.push(id);
  }

  return { services, merged, unmerged: unmerged.sort() };
}
