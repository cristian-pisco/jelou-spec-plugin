// bin/lib/dev-orchestrator/readiness.mjs
//
// HTTP and TCP readiness probes with timeouts. No external deps.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Socket } from 'node:net';

export function probeHttp({ url, expectStatus = 200, timeoutMs = 1000 }) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch { return resolve({ ok: false, error: 'bad-url' }); }
    const requestFn = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const opts = {
      method: 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: (parsed.pathname || '/') + (parsed.search || ''),
      timeout: timeoutMs
    };
    const req = requestFn(opts, (res) => {
      const ok = res.statusCode === expectStatus;
      res.resume();
      resolve({ ok, status: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.end();
  });
}

export function probeTcp({ host, port, timeoutMs = 1000 }) {
  return new Promise((resolve) => {
    const sock = new Socket();
    let done = false;
    const finish = (out) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve(out); };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => finish({ ok: true }));
    sock.on('timeout', () => finish({ ok: false, error: 'timeout' }));
    sock.on('error', (err) => finish({ ok: false, error: err.message }));
    sock.connect(port, host);
  });
}
