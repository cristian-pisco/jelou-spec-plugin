const SENTINEL = 'JLUENV1:';

export function maskWiredEnv(text) {
  if (text == null || text === '') return text;
  return SENTINEL + Buffer.from(text, 'utf8').toString('base64');
}

export function unmaskWiredEnv(masked) {
  if (masked == null || masked === '') return masked;
  if (!masked.startsWith(SENTINEL)) return masked;
  return Buffer.from(masked.slice(SENTINEL.length), 'base64').toString('utf8');
}
