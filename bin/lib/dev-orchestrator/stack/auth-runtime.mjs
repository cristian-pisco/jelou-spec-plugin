import { spawnSync } from 'node:child_process';

export async function postJson(url, body, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
    redirect: 'manual'
  });
  const raw = await res.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  return { status: res.status, json, setCookies: res.headers.getSetCookie() };
}

export function readOtpFromRedis({ redisContainer, redisDb = 0, keyPrefix }) {
  return async (email) => {
    const r = spawnSync('docker', ['exec', redisContainer, 'redis-cli', '-n', String(redisDb), 'GET', `${keyPrefix}${email}`], { encoding: 'utf8' });
    const v = (r.stdout || '').trim().replace(/^"|"$/g, '');
    return v && v !== 'nil' ? v.replace(/\D/g, '') : null;
  };
}
