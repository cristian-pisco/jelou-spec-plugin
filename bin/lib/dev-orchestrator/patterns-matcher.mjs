// bin/lib/dev-orchestrator/patterns-matcher.mjs
//
// Compile + match log-failure patterns. Cooldown for notification dedup.

export function compilePatterns(strings) {
  return strings.map((src) => ({ src, regex: new RegExp(src, 'i') }));
}

export function matchLines(compiled, newLines) {
  const out = [];
  for (const line of newLines) {
    for (const { src, regex } of compiled) {
      if (regex.test(line)) out.push({ pattern: src, line });
    }
  }
  return out;
}

export function Cooldown(seconds) {
  const map = new Map();
  const windowMs = seconds * 1000;
  return {
    allow(key) {
      const now = Date.now();
      const last = map.get(key);
      if (last !== undefined && now - last < windowMs) return false;
      map.set(key, now);
      return true;
    },
    reset() { map.clear(); }
  };
}
