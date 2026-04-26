#!/usr/bin/env node
// extract-trace.mjs — Playwright trace.zip → trace-summary.json
//
// Reads a Playwright trace.zip (a standard zip of NDJSON event streams) and emits
// a structured trace-summary.json the fix-loop agent consumes. Per Premise 11 of the
// design doc:
//
//   The plugin extracts a `trace-summary.json` per failure by unzipping `trace.zip`
//   (it is a standard zip of JSON event streams: trace.trace, trace.network,
//   0-trace.stacks) and reading the relevant event JSON. The summary captures:
//   selector, expected, actual, screenshot path, network log delta, console errors.
//
// IMPORTANT: Pre-M3 spike (per /plan-eng-review decision 14) verified this format
// on Playwright @1.49 (the version pinned by Jelou frontends as of 2026-04-25). If
// you upgrade Playwright, re-run the spike: read the first 5 lines of trace.trace
// from a known-failing trace and confirm the JSON shapes still match the schemas
// in this file. If they don't, switch to the @playwright/test reporter API path
// (commented at the bottom of this file).
//
// Usage:
//   node extract-trace.mjs <path/to/trace.zip> [--out <path>]
//   node extract-trace.mjs --version
//
// Exit codes:
//   0 — wrote summary
//   1 — invalid input (not a zip, missing required entries)
//   2 — empty trace (no failures captured) — wrote {} placeholder
//   3 — unexpected error (caller should treat as bug-in-extractor)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { argv, exit, stdout, stderr } from 'node:process';

const VERSION = '0.1.0';

// ────────────────────────────────────────────────────────────────────────────
// Argument parsing (stdlib only — no commander, no yargs)
// ────────────────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const out = { input: null, output: null, showVersion: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--version' || a === '-v') out.showVersion = true;
    else if (a === '--out' || a === '-o') out.output = args[++i];
    else if (!a.startsWith('-') && !out.input) out.input = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Minimal zip reader (stdlib only — Playwright traces are stored, not deflated,
// for the entries we care about, but we handle deflate too via zlib.inflateRaw).
// ────────────────────────────────────────────────────────────────────────────

function readZipEntries(buf) {
  // Locate End of Central Directory (EOCD) record. Up to 22 bytes from end +
  // optional comment up to 65535 bytes.
  let eocdOffset = -1;
  const minSearch = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minSearch; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error('not a zip file (no EOCD record found)');

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  let p = cdOffset;
  for (let e = 0; e < entryCount; e++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`central directory entry ${e}: bad signature`);
    }
    const compMethod = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lhOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    // Skip directory entries
    if (!name.endsWith('/')) {
      // Read local header to get the actual data offset
      if (buf.readUInt32LE(lhOffset) !== 0x04034b50) {
        throw new Error(`local header for '${name}': bad signature`);
      }
      const lhNameLen = buf.readUInt16LE(lhOffset + 26);
      const lhExtraLen = buf.readUInt16LE(lhOffset + 28);
      const dataStart = lhOffset + 30 + lhNameLen + lhExtraLen;
      const dataEnd = dataStart + compSize;
      const compressed = buf.slice(dataStart, dataEnd);

      let data;
      if (compMethod === 0) {
        data = compressed;
      } else if (compMethod === 8) {
        // Raw deflate (zip method 8 has no zlib header — use inflateRaw, not unzip).
        data = inflateRawSync(compressed);
      } else {
        throw new Error(`'${name}': unsupported compression method ${compMethod}`);
      }
      if (data.length !== uncompSize) {
        // Some Playwright traces store size in the data descriptor; allow length to differ
        // only if compMethod is deflate (the inflate output is authoritative).
        if (compMethod === 0) {
          throw new Error(`'${name}': size mismatch (got ${data.length}, expected ${uncompSize})`);
        }
      }
      entries.set(name, data);
    }

    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ────────────────────────────────────────────────────────────────────────────
// Event stream parsing
// ────────────────────────────────────────────────────────────────────────────

function parseNDJSON(buf) {
  const text = buf.toString('utf8');
  const out = [];
  let lineStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      const line = text.slice(lineStart, i).trim();
      lineStart = i + 1;
      if (!line) continue;
      try { out.push(JSON.parse(line)); }
      catch { /* skip malformed line; trace files occasionally have tail garbage */ }
    }
  }
  // Last line without trailing newline
  const tail = text.slice(lineStart).trim();
  if (tail) {
    try { out.push(JSON.parse(tail)); } catch {}
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Summary extraction
// ────────────────────────────────────────────────────────────────────────────

function extractSummary(entries) {
  // Required entries (Playwright @1.49). If the schema changes upstream, the spike
  // catches it and you switch to the reporter-API fallback.
  const traceBuf = entries.get('trace.trace');
  if (!traceBuf) {
    throw new Error("missing required entry 'trace.trace' — was this produced by Playwright?");
  }
  const networkBuf = entries.get('trace.network');
  if (!networkBuf) {
    // Network stream is optional in some traces (e.g., when the browser made no requests)
  }

  const traceEvents = parseNDJSON(traceBuf);
  const networkEvents = networkBuf ? parseNDJSON(networkBuf) : [];

  // Find the first 'before' event with type='action' that errored.
  // Playwright trace events carry `class` (action|frame|...) and `error` when the action threw.
  const errored = traceEvents.find(
    (e) => e.type === 'before' && e.class === 'action' && (e.error || e.errorText),
  );

  if (!errored) {
    // Fall back: find any event with an 'error' field. If none, the trace has no failure.
    const anyError = traceEvents.find((e) => e.error);
    if (!anyError) return { empty: true };
  }

  const failure = errored ?? traceEvents.find((e) => e.error);

  // Best-effort extraction of selector / expected / actual.
  const selector = failure.params?.selector ?? failure.selector ?? null;
  const expected = failure.params?.expected ?? failure.expected ?? null;
  const actual = failure.params?.actual ?? failure.actual ?? null;
  const errorMessage = failure.error?.message ?? failure.errorText ?? 'unknown error';
  const errorStack = failure.error?.stack ?? null;

  // Screenshot reference: most traces store screenshots as separate entries
  // named like 'resources/<sha>.png'. We expose the largest such PNG before
  // the failure (if any) — heuristic, but the fix-loop only needs a stable handle.
  const screenshots = [...entries.keys()]
    .filter((k) => k.endsWith('.png'))
    .sort();
  const screenshotPath = screenshots[screenshots.length - 1] ?? null;

  // Network delta: count failed requests + last 5 entries.
  const failedRequests = networkEvents.filter(
    (e) => e.type === 'response' && typeof e.status === 'number' && e.status >= 400,
  );
  const networkSummary = {
    total_requests: networkEvents.filter((e) => e.type === 'request').length,
    failed_requests: failedRequests.length,
    last_failed: failedRequests.slice(-5).map((e) => ({
      url: e.url,
      status: e.status,
      method: e.method ?? null,
    })),
  };

  // Console errors: trace.trace may interleave console events; collect them.
  const consoleErrors = traceEvents
    .filter((e) => e.type === 'console' && (e.level === 'error' || e.severity === 'error'))
    .slice(-10)
    .map((e) => e.text ?? e.message ?? '');

  return {
    empty: false,
    test_title: failure.metadata?.testTitle ?? null,
    test_file: failure.metadata?.location?.file ?? null,
    test_line: failure.metadata?.location?.line ?? null,
    failed_action: failure.method ?? failure.apiName ?? null,
    selector,
    expected,
    actual,
    error_message: errorMessage,
    error_stack: errorStack,
    screenshot_path: screenshotPath,
    network: networkSummary,
    console_errors: consoleErrors,
    extractor_version: VERSION,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  let args;
  try { args = parseArgs(argv.slice(2)); }
  catch (e) { stderr.write(`extract-trace: ${e.message}\n`); exit(1); }

  if (args.showVersion) { stdout.write(`${VERSION}\n`); exit(0); }
  if (!args.input) {
    stderr.write('extract-trace: usage: extract-trace.mjs <trace.zip> [--out <path>]\n');
    exit(1);
  }

  let buf;
  try { buf = await readFile(args.input); }
  catch (e) { stderr.write(`extract-trace: cannot read '${args.input}': ${e.message}\n`); exit(1); }

  let entries;
  try { entries = readZipEntries(buf); }
  catch (e) { stderr.write(`extract-trace: ${args.input}: ${e.message}\n`); exit(1); }

  let summary;
  try { summary = extractSummary(entries); }
  catch (e) { stderr.write(`extract-trace: ${args.input}: ${e.message}\n`); exit(3); }

  const outPath =
    args.output ??
    join(dirname(args.input), basename(args.input, '.zip') + '-summary.json');

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(summary, null, 2) + '\n');

  if (summary.empty) {
    stdout.write(`extract-trace: empty trace (no failures captured) → ${outPath}\n`);
    exit(2);
  }
  stdout.write(`extract-trace: wrote ${outPath}\n`);
  exit(0);
}

// ────────────────────────────────────────────────────────────────────────────
// Fallback path (commented)
//
// If the spike reveals the trace.zip internal format has shifted in a way this
// extractor can't handle, switch the consumer's playwright.config.ts to add a
// custom reporter that writes the summary directly at run time. Reporter API
// reference: https://playwright.dev/docs/api/class-reporter
//
// // playwright.config.ts (consumer side)
// reporter: [
//   ['list'],
//   ['json', { outputFile: 'playwright-output/results.json' }],
//   ['./jelou-ui-qa-reporter.mjs'],   // <-- custom reporter
// ],
//
// The custom reporter consumes Playwright's TestCase / TestResult objects and
// writes the same trace-summary.json shape this extractor produces. The fix-loop
// is unaffected — it reads trace-summary.json regardless of how it was produced.
// ────────────────────────────────────────────────────────────────────────────

await main();
