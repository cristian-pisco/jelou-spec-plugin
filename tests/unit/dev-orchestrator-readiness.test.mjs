// tests/unit/dev-orchestrator-readiness.test.mjs
import { test, describe, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { probeHttp, probeTcp } from '../../bin/lib/dev-orchestrator/readiness.mjs';

let httpServer, tcpServer, httpPort, tcpPort;

before(async () => {
  await new Promise((resolve) => {
    httpServer = createHttpServer((req, res) => {
      if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
      if (req.url === '/notyet') { res.writeHead(503); res.end('busy'); return; }
      res.writeHead(404); res.end();
    }).listen(0, '127.0.0.1', () => { httpPort = httpServer.address().port; resolve(); });
  });
  await new Promise((resolve) => {
    tcpServer = createNetServer((s) => s.end()).listen(0, '127.0.0.1', () => { tcpPort = tcpServer.address().port; resolve(); });
  });
});

after(async () => {
  await new Promise(r => httpServer.close(r));
  await new Promise(r => tcpServer.close(r));
});

describe('probeHttp', () => {
  test('returns ok when status matches', async () => {
    const out = await probeHttp({ url: `http://127.0.0.1:${httpPort}/health` });
    assert.equal(out.ok, true);
    assert.equal(out.status, 200);
  });
  test('returns not-ok when status differs', async () => {
    const out = await probeHttp({ url: `http://127.0.0.1:${httpPort}/notyet`, expectStatus: 200 });
    assert.equal(out.ok, false);
    assert.equal(out.status, 503);
  });
  test('returns not-ok on connection refused', async () => {
    const out = await probeHttp({ url: 'http://127.0.0.1:1', timeoutMs: 500 });
    assert.equal(out.ok, false);
    assert.ok(out.error);
  });
  test('returns not-ok on timeout', async () => {
    // Connect to a non-routable address; no server. Should time out.
    const out = await probeHttp({ url: 'http://10.255.255.1:81/health', timeoutMs: 200 });
    assert.equal(out.ok, false);
    assert.ok(out.error);
  });
});

describe('probeTcp', () => {
  test('returns ok when port is open', async () => {
    const out = await probeTcp({ host: '127.0.0.1', port: tcpPort, timeoutMs: 500 });
    assert.equal(out.ok, true);
  });
  test('returns not-ok when port is closed', async () => {
    const out = await probeTcp({ host: '127.0.0.1', port: 1, timeoutMs: 500 });
    assert.equal(out.ok, false);
    assert.ok(out.error);
  });
});
