import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EVENT_KIND, SPAN_NAMES, SIGNAL } from './schema.mjs';

const VALID_SIGNALS = new Set(Object.values(SIGNAL));

export function appendFeedback(file, { span_id, signal, source, note, ts } = {}) {
  if (!VALID_SIGNALS.has(signal)) {
    throw new Error(
      `invalid signal "${signal}" — must be one of ${[...VALID_SIGNALS].join(', ')}`,
    );
  }
  if (process.env.TRACE_DISABLED === '1') return;

  const entry = { ts: ts || new Date().toISOString(), span_id, signal, source, note };
  for (const key of Object.keys(entry)) {
    if (entry[key] === undefined) delete entry[key];
  }
  const line = JSON.stringify(entry);

  try {
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(file, line + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(`[feedback] write failed for ${file}: ${err.message}\n`);
  }
}

export function readFeedback(file) {
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    process.stderr.write(`[feedback] read failed for ${file}: ${err.message}\n`);
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      process.stderr.write(`[feedback] skip malformed line in ${file}\n`);
    }
  }
  return out;
}

export function harvestImplicitNegatives(pairs) {
  const out = [];
  for (const pair of pairs) {
    if (pair.start?.name !== SPAN_NAMES.AGENT_DISPATCH) continue;
    if ((pair.end?.attrs?.retry_count ?? 0) > 0) {
      out.push({
        span_id: pair.start.span_id,
        signal: SIGNAL.IMPLICIT_NEGATIVE,
        source: 're_dispatch',
      });
    }
  }
  return out;
}

export function resolveShipSpanId(events, task_slug) {
  let best = null;
  for (const e of events) {
    if (e.event_kind !== EVENT_KIND.SPAN_START) continue;
    if (e.name !== SPAN_NAMES.SHIP) continue;
    if (e.task_slug !== task_slug) continue;
    if (!best || String(e.ts) >= String(best.ts)) best = e;
  }
  return best ? best.span_id : null;
}
