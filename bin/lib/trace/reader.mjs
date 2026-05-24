// bin/lib/trace/reader.mjs
//
// Iterative JSONL reader for the tracing store. Stdlib-only.
//   - readSpans(file, { filter? }): generator of parsed events. Skip-malformed.
//   - listRotatedFiles(baseFile): rotated siblings (spans-NNN.jsonl) + base in order.
//
// Implementation note: readSpans is lazy in iteration (callers can `break` early
// to stop parsing), but the underlying read is a full-file load via
// readFileSync — peak memory is proportional to the file size at the moment
// it is read. For the 50 MB rotation threshold this is acceptable; rotated
// siblings are read one file at a time, so the working set never exceeds
// one rotation's worth.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

export function* readSpans(file, { filter } = {}) {
  if (!existsSync(file)) return;
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    process.stderr.write(`[trace] read failed for ${file}: ${err.message}\n`);
    return;
  }
  const lines = raw.split('\n');
  for (const line of lines) {
    if (!line) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      process.stderr.write(`[trace] skip malformed line in ${file}\n`);
      continue;
    }
    if (filter && !filter(evt)) continue;
    yield evt;
  }
}

export function listRotatedFiles(baseFile) {
  const dir = dirname(baseFile);
  const base = basename(baseFile);                    // spans.jsonl
  const stem = base.replace(/\.jsonl$/, '');          // spans
  if (!existsSync(dir)) return [];
  const siblings = readdirSync(dir).filter((f) => {
    if (f === base) return existsSync(join(dir, f));
    return f.startsWith(`${stem}-`) && f.endsWith('.jsonl');
  });
  if (!siblings.length) return [];
  // Sort rotated (numbered) first ascending, then base last.
  siblings.sort((a, b) => {
    if (a === base) return 1;
    if (b === base) return -1;
    return a.localeCompare(b);
  });
  return siblings.map((f) => join(dir, f));
}
