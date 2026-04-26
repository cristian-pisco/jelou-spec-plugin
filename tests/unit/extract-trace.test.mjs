// Unit tests for bin/extract-trace.mjs
//
// Run: `node --test tests/unit/extract-trace.test.mjs`
// Node 20+ required (built-in test runner + zlib.deflateRawSync).

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const EXTRACTOR = new URL('../../bin/extract-trace.mjs', import.meta.url).pathname;

// ────────────────────────────────────────────────────────────────────────────
// Helpers — build minimal Playwright-shaped trace.zip files in-memory
// ────────────────────────────────────────────────────────────────────────────

function buildZip(entries) {
  // entries: { [filename]: Buffer | string }
  const localHeaders = [];
  const centralHeaders = [];
  const dataChunks = [];
  let offset = 0;

  for (const [name, raw] of Object.entries(entries)) {
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
    const compressed = deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const stored = useDeflate ? compressed : data;
    const compMethod = useDeflate ? 8 : 0;

    const nameBuf = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);                    // version needed
    lh.writeUInt16LE(0, 6);                      // flags
    lh.writeUInt16LE(compMethod, 8);
    lh.writeUInt16LE(0, 10);                     // mod time
    lh.writeUInt16LE(0, 12);                     // mod date
    lh.writeUInt32LE(0, 14);                     // crc32 (fake; this extractor doesn't validate)
    lh.writeUInt32LE(stored.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);                     // extra len

    localHeaders.push({ buf: Buffer.concat([lh, nameBuf]), offset, dataLen: stored.length });
    dataChunks.push(stored);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);                      // flags
    ch.writeUInt16LE(compMethod, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(0, 16);                     // crc32
    ch.writeUInt32LE(stored.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);                     // extra len
    ch.writeUInt16LE(0, 32);                     // comment len
    ch.writeUInt16LE(0, 34);                     // disk number
    ch.writeUInt16LE(0, 36);                     // internal attrs
    ch.writeUInt32LE(0, 38);                     // external attrs
    ch.writeUInt32LE(offset, 42);                // local header offset
    centralHeaders.push(Buffer.concat([ch, nameBuf]));

    offset += lh.length + nameBuf.length + stored.length;
  }

  // Central directory
  const cdStart = offset;
  const cdParts = centralHeaders;
  const cdSize = cdParts.reduce((s, b) => s + b.length, 0);

  // EOCD
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralHeaders.length, 8);
  eocd.writeUInt16LE(centralHeaders.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);                     // comment len

  return Buffer.concat([
    ...localHeaders.map((h, i) => Buffer.concat([h.buf, dataChunks[i]])),
    ...cdParts,
    eocd,
  ]);
}

function ndjson(events) {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

function runExtractor(zipPath) {
  const r = spawnSync('node', [EXTRACTOR, zipPath], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('extract-trace.mjs', () => {
  test('valid trace with one failure → wrote summary with selector/expected/actual', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extract-test-'));
    const zipPath = join(dir, 'trace.zip');

    const traceEvents = [
      { type: 'before', class: 'action', method: 'click', metadata: { testTitle: 'cancel flow', location: { file: 'cancel.spec.ts', line: 10 } } },
      { type: 'before', class: 'action', method: 'expect',
        params: { selector: 'getByRole(button, name=Confirm)', expected: 'visible', actual: 'hidden' },
        error: { message: 'expect.toBeVisible: Element not found', stack: 'at expect (cancel.spec.ts:42)' },
        metadata: { testTitle: 'cancel flow', location: { file: 'cancel.spec.ts', line: 42 } },
      },
    ];
    const networkEvents = [
      { type: 'request', method: 'GET', url: 'http://localhost:3000/api/me' },
      { type: 'response', url: 'http://localhost:3000/api/me', status: 200 },
    ];

    writeFileSync(zipPath, buildZip({
      'trace.trace': ndjson(traceEvents),
      'trace.network': ndjson(networkEvents),
    }));

    const r = runExtractor(zipPath);
    assert.equal(r.code, 0, `extractor failed: ${r.stderr}`);

    const summary = JSON.parse(readFileSync(join(dir, 'trace-summary.json'), 'utf8'));
    assert.equal(summary.empty, false);
    assert.equal(summary.selector, 'getByRole(button, name=Confirm)');
    assert.equal(summary.expected, 'visible');
    assert.equal(summary.actual, 'hidden');
    assert.match(summary.error_message, /Element not found/);
    assert.equal(summary.test_title, 'cancel flow');
    assert.equal(summary.test_line, 42);
    assert.equal(summary.network.total_requests, 1);
    assert.equal(summary.network.failed_requests, 0);
  });

  test('malformed zip → exit 1 with friendly message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extract-test-'));
    const zipPath = join(dir, 'malformed.zip');
    writeFileSync(zipPath, Buffer.from('not a zip file at all'));

    const r = runExtractor(zipPath);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not a zip file/);
  });

  test('empty trace (no failures) → exit 2 with placeholder summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extract-test-'));
    const zipPath = join(dir, 'empty.zip');

    // A valid trace.trace with only 'before' events that have no errors
    writeFileSync(zipPath, buildZip({
      'trace.trace': ndjson([
        { type: 'before', class: 'action', method: 'goto' },
        { type: 'after', class: 'action', method: 'goto' },
      ]),
    }));

    const r = runExtractor(zipPath);
    assert.equal(r.code, 2);
    const summary = JSON.parse(readFileSync(join(dir, 'empty-summary.json'), 'utf8'));
    assert.equal(summary.empty, true);
  });

  test('zip missing trace.trace → exit 3 with descriptive message', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extract-test-'));
    const zipPath = join(dir, 'no-trace.zip');
    writeFileSync(zipPath, buildZip({
      'trace.network': ndjson([{ type: 'request', url: 'http://x' }]),
    }));

    const r = runExtractor(zipPath);
    assert.equal(r.code, 3);
    assert.match(r.stderr, /missing required entry 'trace\.trace'/);
  });

  test('failed network request surfaces in summary.network.last_failed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extract-test-'));
    const zipPath = join(dir, 'with-network.zip');

    writeFileSync(zipPath, buildZip({
      'trace.trace': ndjson([
        { type: 'before', class: 'action', method: 'click',
          error: { message: 'click failed' },
          metadata: { testTitle: 't', location: { file: 'x', line: 1 } },
        },
      ]),
      'trace.network': ndjson([
        { type: 'request', method: 'POST', url: '/api/cancel' },
        { type: 'response', method: 'POST', url: '/api/cancel', status: 500 },
        { type: 'request', method: 'GET', url: '/api/me' },
        { type: 'response', method: 'GET', url: '/api/me', status: 200 },
      ]),
    }));

    const r = runExtractor(zipPath);
    assert.equal(r.code, 0);
    const summary = JSON.parse(readFileSync(join(dir, 'with-network-summary.json'), 'utf8'));
    assert.equal(summary.network.failed_requests, 1);
    assert.equal(summary.network.last_failed[0].url, '/api/cancel');
    assert.equal(summary.network.last_failed[0].status, 500);
  });

  test('real Playwright layout (prefixed entries + resource-snapshot network) parses correctly', () => {
    // Mirrors the on-disk shape produced by Playwright 1.49.x: multiple `*-trace.trace`
    // streams, after-events carrying the error, before-events linked by callId/stepId,
    // and HAR-shaped `resource-snapshot` network events.
    const dir = mkdtempSync(join(tmpdir(), 'extract-test-'));
    const zipPath = join(dir, 'real.zip');

    const browserBefore = {
      type: 'before',
      callId: 'call@32',
      stepId: 'expect@17',
      apiName: 'expect.toHaveText',
      class: 'Frame',
      method: 'expect',
      params: {
        selector: 'internal:role=status',
        expectedText: [{ string: 'Your plan was downgraded to Free.' }],
        timeout: 5000,
      },
    };
    const testBefore = {
      type: 'before',
      callId: 'expect@17',
      class: 'Test',
      method: 'step',
      apiName: 'expect.toHaveText',
      params: { expected: 'Your plan was downgraded to Free.' },
    };
    const testAfter = {
      type: 'after',
      callId: 'expect@17',
      error: { name: '', message: 'Timed out 5000ms', stack: 'at expect (cancel.spec.ts:11:42)' },
    };
    const errorEvent = {
      type: 'error',
      message: 'Timed out 5000ms',
      stack: [{ file: '/repo/cancel.spec.ts', line: 11, column: 42 }],
    };
    const contextOptions = {
      version: 7,
      type: 'context-options',
      origin: 'library',
      title: 'cancel.spec.ts:4 › cancel flow',
    };

    const networkSnapshot = (status, url, method) => ({
      type: 'resource-snapshot',
      snapshot: { request: { url, method }, response: { status } },
    });

    writeFileSync(zipPath, buildZip({
      'test.trace': ndjson([contextOptions, testBefore, testAfter, errorEvent]),
      '0-trace.trace': ndjson([{ type: 'context-options', origin: 'library' }]),
      '1-trace.trace': ndjson([{ ...contextOptions, origin: 'library' }, browserBefore]),
      '1-trace.network': ndjson([
        networkSnapshot(200, 'http://localhost:4001/dashboard', 'GET'),
        networkSnapshot(500, 'http://localhost:4001/api/subscriptions/cancel', 'POST'),
      ]),
    }));

    const r = runExtractor(zipPath);
    assert.equal(r.code, 0, `extractor failed: ${r.stderr}`);

    const summary = JSON.parse(readFileSync(join(dir, 'real-summary.json'), 'utf8'));
    assert.equal(summary.empty, false);
    assert.equal(summary.selector, 'internal:role=status');
    assert.equal(summary.expected, 'Your plan was downgraded to Free.');
    assert.equal(summary.test_title, 'cancel.spec.ts:4 › cancel flow');
    assert.equal(summary.test_file, '/repo/cancel.spec.ts');
    assert.equal(summary.test_line, 11);
    assert.equal(summary.network.total_requests, 2);
    assert.equal(summary.network.failed_requests, 1);
    assert.equal(summary.network.last_failed[0].url, 'http://localhost:4001/api/subscriptions/cancel');
    assert.equal(summary.network.last_failed[0].status, 500);
    assert.equal(summary.network.last_failed[0].method, 'POST');
  });

  test('--version → exit 0 with version string', () => {
    const r = spawnSync('node', [EXTRACTOR, '--version'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\d+\.\d+\.\d+/);
  });
});
