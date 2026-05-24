// bin/lib/trace/emitter.mjs
//
// Single-writer JSONL emitter for the tracing system. Stdlib-only.
//   - ulid(): 26-char Crockford base32 monotonic id.
//   - appendSpan(file, event): one fs.appendFileSync; auto-creates parent dirs;
//     enforces PAYLOAD_CAP_BYTES by dropping `outcome`/`artifacts` when over cap;
//     short-circuits when TRACE_DISABLED=1; falls back to stderr on write error.
//   - startSpan(file, { scope, name, parent_span_id?, trace_id?, ... }):
//     wraps appendSpan for the SPAN_START case, generating span_id + trace_id
//     when not provided.
//   - endSpan(file, { span_id, trace_id, name, scope, status, duration_ms?, attrs? }):
//     wraps appendSpan for the SPAN_END case.
//
// File appends < PIPE_BUF (4 KB) are atomic on Linux/macOS, so concurrent writers
// to the same file do not interleave bytes. We enforce that bound via PAYLOAD_CAP_BYTES.

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EVENT_KIND, PAYLOAD_CAP_BYTES } from './schema.mjs';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastMs = 0;
let lastRandom = Buffer.alloc(10);

export function ulid() {
  let ms = Date.now();
  if (ms <= lastMs) {
    ms = lastMs;
    // Increment lastRandom as a big-endian 80-bit integer with carry.
    for (let i = 9; i >= 0; i--) {
      if (lastRandom[i] < 0xff) {
        lastRandom[i] += 1;
        break;
      }
      lastRandom[i] = 0;
      // If we overflow past byte 0, advance the timestamp by 1 ms instead
      // of producing a non-monotonic id.
      if (i === 0) {
        ms += 1;
        lastMs = ms;
        lastRandom = randomBytes(10);
      }
    }
  } else {
    lastMs = ms;
    lastRandom = randomBytes(10);
  }
  let tsPart = '';
  let t = ms;
  for (let i = 9; i >= 0; i--) {
    tsPart = CROCKFORD[t % 32] + tsPart;
    t = Math.floor(t / 32);
  }
  let bin = '';
  for (const b of lastRandom) bin += b.toString(2).padStart(8, '0');
  let randPart = '';
  for (let i = 0; i < 16; i++) {
    randPart += CROCKFORD[parseInt(bin.slice(i * 5, (i + 1) * 5), 2)];
  }
  return tsPart + randPart;
}

export function appendSpan(file, event) {
  if (process.env.TRACE_DISABLED === '1') return;

  const out = { ts: event.ts || new Date().toISOString(), ...event };

  let line = JSON.stringify(out);
  if (Buffer.byteLength(line, 'utf8') > PAYLOAD_CAP_BYTES) {
    if (out.attrs) {
      const trimmed = { ...out.attrs };
      delete trimmed.outcome;
      delete trimmed.artifacts;
      trimmed.payload_capped = true;
      out.attrs = trimmed;
    }
    line = JSON.stringify(out);
    // If still over cap, drop attrs entirely as a last resort.
    if (Buffer.byteLength(line, 'utf8') > PAYLOAD_CAP_BYTES) {
      out.attrs = { payload_capped: true };
      line = JSON.stringify(out);
    }
  }

  try {
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(file, line + '\n', 'utf8');
  } catch (err) {
    process.stderr.write(
      `[trace] write failed for ${file}: ${err.message}\n`
    );
  }
}

export function startSpan(file, event) {
  const trace_id = event.trace_id || ulid();
  const span_id = ulid();
  appendSpan(file, {
    event_kind: EVENT_KIND.SPAN_START,
    span_id,
    trace_id,
    parent_span_id: event.parent_span_id || undefined,
    scope: event.scope,
    name: event.name,
    task_slug: event.task_slug,
    service_id: event.service_id,
    phase_num: event.phase_num,
    agent_role: event.agent_role,
    attrs: event.attrs,
  });
  return { span_id, trace_id, parent_span_id: event.parent_span_id || null };
}

export function endSpan(file, event) {
  appendSpan(file, {
    event_kind: EVENT_KIND.SPAN_END,
    span_id: event.span_id,
    trace_id: event.trace_id,
    parent_span_id: event.parent_span_id || undefined,
    scope: event.scope,
    name: event.name,
    task_slug: event.task_slug,
    service_id: event.service_id,
    phase_num: event.phase_num,
    agent_role: event.agent_role,
    duration_ms: event.duration_ms,
    status: event.status,
    attrs: event.attrs,
  });
}
