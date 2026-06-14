// bin/lib/e2e-auth.mjs — pure helpers for the E2E auth gate.
//
// Shared by bin/e2e-login.mjs (OTP login driver), bin/e2e-session-probe.mjs
// (session validity probe) and bin/detect-auth-collapse.mjs (mid-suite 401
// detector). Everything here is side-effect-free except waitForFile, which
// is the OTP handshake: the login script polls a file the orchestrator
// writes after reading the code from Gmail.

import { existsSync, readFileSync, rmSync } from 'node:fs';

export const EXIT = {
  OK: 0,
  AUTH_REJECTED: 41,
  OTP_TIMEOUT: 42,
  OTP_REJECTED: 43,
  LOGIN_FORM_NOT_FOUND: 44,
  SECRET_MISMATCH: 45,
  MONGO_UNREACHABLE: 46,
  CAPTCHA_BLOCKED: 47,
};

export function parseFlatYaml(text) {
  const out = {};
  if (typeof text !== 'string') return out;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf(':');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let value = t.slice(i + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

// Values are wrapped in plain double-quotes (not JSON.stringify) because parseFlatYaml strips
// exactly one outer quote pair and does NOT JSON-unescape — JSON.stringify would double-escape
// backslashes and break the roundtrip. Values are assumed to be single-line and quote-free.
export function serializeFlatYaml(obj) {
  return `${Object.entries(obj)
    .map(([k, v]) => `${k}: "${String(v)}"`)
    .join('\n')}\n`;
}

export function extractOtp(text, codeRegex) {
  if (typeof text !== 'string' || !text) return null;
  let re;
  try {
    re = new RegExp(codeRegex || '\\b(\\d{4,8})\\b');
  } catch {
    return null;
  }
  const m = re.exec(text);
  if (!m) return null;
  return m[1] ?? m[0]; // regex without a capture group falls back to the full match
}

// Segment-wise matching avoids the unanchored-substring trap: '/auth-callback'
// and '/settings/login-history' are logged-in routes; '/auth', '/otp' and
// '/verification-code' are not. 'verif' matches as a segment prefix to cover
// verification/verificacion variants.
export function isLoggedOutUrl(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = String(url ?? '');
  }
  return pathname
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .some((seg) => ['login', 'signin', 'auth', 'otp'].includes(seg) || seg.startsWith('verif'));
}

export function classifyProbeOutcome({ finalUrl, apiStatuses = [] }) {
  if (typeof finalUrl === 'string' && isLoggedOutUrl(finalUrl)) return 'invalid';
  if (apiStatuses.includes(401)) return 'invalid';
  return 'valid';
}

const AUTH_ERROR_RE = /(\b401\b|unauthorized)/i;

export function detectAuthCollapse(errorMessages, threshold = 3) {
  let streak = 0;
  for (const msg of errorMessages ?? []) {
    if (typeof msg === 'string' && AUTH_ERROR_RE.test(msg)) {
      streak += 1;
      if (streak >= threshold) return true;
    } else {
      streak = 0;
    }
  }
  return false;
}

export function collectFailureMessages(report) {
  const out = [];
  const walk = (suites) => {
    for (const s of suites ?? []) {
      for (const spec of s.specs ?? []) {
        for (const t of spec.tests ?? []) {
          for (const r of t.results ?? []) {
            if (r.status === 'failed' || r.status === 'timedOut' || r.status === 'interrupted') {
              out.push(String(r.error?.message ?? ''));
            }
          }
        }
      }
      walk(s.suites);
    }
  };
  walk(report?.suites);
  return out;
}

export async function waitForFile(path, timeoutMs, pollMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8').trim();
      try {
        rmSync(path);
      } catch {
        // already consumed by a parallel reader — content is still ours
      }
      if (content) return content;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}
