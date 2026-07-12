import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function parseExample(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (typeof obj.id !== 'string' || !obj.id.trim()) return null;
  return obj;
}

function jsonFilesIn(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries;
}

export function loadGolden(dir) {
  if (!dir || !existsSync(dir)) return [];
  const out = [];
  for (const entry of jsonFilesIn(dir)) {
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const example = parseExample(full);
      if (example) out.push(example);
    } else if (entry.isDirectory()) {
      for (const child of jsonFilesIn(full)) {
        if (child.isFile() && child.name.endsWith('.json')) {
          const example = parseExample(join(full, child.name));
          if (example) out.push(example);
        }
      }
    }
  }
  return out;
}

export function detectRegression(current, baseline, { margin = 0.05, perExampleMargin = 0.15 } = {}) {
  const cur = current && typeof current === 'object' ? current : {};
  const base = baseline && typeof baseline === 'object' ? baseline : {};

  const per_example = [];
  for (const id of Object.keys(cur)) {
    if (!(id in base)) continue;
    const c = Number(cur[id]);
    const b = Number(base[id]);
    if (!Number.isFinite(c) || !Number.isFinite(b)) continue;
    per_example.push({ id, current: c, baseline: b, delta: c - b });
  }

  if (per_example.length === 0) {
    return {
      regressed: false,
      mean_current: 0,
      mean_baseline: 0,
      delta: 0,
      improved: 0,
      dropped: 0,
      per_example: [],
    };
  }

  const n = per_example.length;
  const mean_current = per_example.reduce((acc, e) => acc + e.current, 0) / n;
  const mean_baseline = per_example.reduce((acc, e) => acc + e.baseline, 0) / n;
  const delta = mean_current - mean_baseline;
  const improved = per_example.filter((e) => e.delta > 0).length;
  const dropped = per_example.filter((e) => e.delta < 0).length;
  const steepDrop = per_example.some((e) => e.delta < -perExampleMargin);
  const regressed = delta < -margin || steepDrop;

  return { regressed, mean_current, mean_baseline, delta, improved, dropped, per_example };
}
