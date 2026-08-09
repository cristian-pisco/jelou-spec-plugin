import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { stateDir } from '../state.mjs';

function isGenuineAuthCookie(cookie) {
  return cookie?.name === 'jelou_auth' && typeof cookie.value === 'string' && cookie.value.length > 0;
}

export function authCookiePath(opts) {
  return join(stateDir(opts), 'auth-cookie.json');
}

export function readAuthCookie(opts) {
  const path = authCookiePath(opts);
  if (!existsSync(path)) return null;
  try {
    const cookie = JSON.parse(readFileSync(path, 'utf8'));
    return isGenuineAuthCookie(cookie) ? cookie : null;
  } catch {
    return null;
  }
}

export function writeAuthCookie(opts, cookie) {
  if (!isGenuineAuthCookie(cookie)) throw new Error('only a genuine jelou_auth cookie can be persisted');
  const path = authCookiePath(opts);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(cookie)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  return path;
}

export function clearAuthCookie(opts) {
  const path = authCookiePath(opts);
  if (existsSync(path)) rmSync(path);
}
