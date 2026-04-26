// Tiny Express-shaped API for the jelou-ui-qa sample consumer.
// Stdlib only — no Express dependency, just `node:http`. Goal: zero install time in CI.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 4001);

// In-memory state (fine for CI; not real)
const state = {
  users: new Map(),         // email → { id, role, password, subscription_status }
  sessions: new Map(),      // token → { user_id, expires_at }
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function authUser(req) {
  const cookie = req.headers.cookie ?? '';
  const m = cookie.match(/auth_token=([^;]+)/);
  if (!m) return null;
  const session = state.sessions.get(m[1]);
  if (!session || session.expires_at < Date.now()) return null;
  return [...state.users.values()].find((u) => u.id === session.user_id) ?? null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    return json(res, 200, { status: 'ok' });
  }

  // Test-only fixture endpoints
  if (url.pathname === '/api/test/seed' && req.method === 'POST') {
    const body = await readBody(req);
    const id = randomBytes(8).toString('hex');
    state.users.set(body.email, {
      id, role: body.role ?? 'user',
      password: body.password ?? 'test',
      subscription_status: body.subscription_status ?? 'pro',
    });
    return json(res, 200, { user_id: id });
  }

  if (url.pathname === '/api/test/login' && req.method === 'POST') {
    const body = await readBody(req);
    const user = state.users.get(body.email ?? 'pro@example.test');
    if (!user) return json(res, 401, { error: 'unknown user' });
    if (Number(body.ttl_s ?? 3600) > 3600) {
      return json(res, 400, { error: 'token TTL must be <= 3600 seconds (auth-fixtures.md contract)' });
    }
    const token = randomBytes(16).toString('hex');
    state.sessions.set(token, { user_id: user.id, expires_at: Date.now() + (body.ttl_s ?? 3600) * 1000 });
    return json(res, 200, { token });
  }

  // Real endpoints (the cancellation flow)
  if (url.pathname === '/api/subscriptions/me' && req.method === 'GET') {
    const user = authUser(req);
    if (!user) return json(res, 401, { error: 'not authenticated' });
    return json(res, 200, { status: user.subscription_status });
  }

  if (url.pathname === '/api/subscriptions/cancel' && req.method === 'POST') {
    const user = authUser(req);
    if (!user) return json(res, 401, { error: 'not authenticated' });

    // Deliberate-bug switch for the fix-loop CI flow:
    // Set BUG_MODE=500 to force a 500 (exercises fixture 001-backend-500's mirror in CI E2E).
    if (process.env.BUG_MODE === '500') {
      return json(res, 500, { error: 'simulated downstream failure' });
    }

    user.subscription_status = 'canceled';
    return json(res, 200, { status: 'canceled' });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`sample-consumer api listening on :${PORT}`);
});
