import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskWiredEnv, unmaskWiredEnv } from '../../bin/lib/boot-engine/env-mask.mjs';

test('round-trips arbitrary text through mask/unmask', () => {
  for (const x of ['', 'A=1', 'A=1\nB=two\n', 'k=áé\nJELOU=http://x-slug:8080\n']) {
    assert.equal(unmaskWiredEnv(maskWiredEnv(x)), x);
  }
});

test('masked non-empty text is not the plaintext and carries the sentinel', () => {
  const masked = maskWiredEnv('SECRET=supersecretvalue\n');
  assert.ok(masked.startsWith('JLUENV1:'));
  assert.ok(!masked.includes('supersecretvalue'));
});

test('unmask of non-sentinel input is a verbatim no-op', () => {
  assert.equal(unmaskWiredEnv('A=1\nB=2\n'), 'A=1\nB=2\n');
});

test('null/empty passthrough preserves the callers null contract', () => {
  assert.equal(maskWiredEnv(''), '');
  assert.equal(maskWiredEnv(null), null);
  assert.equal(unmaskWiredEnv(''), '');
  assert.equal(unmaskWiredEnv(null), null);
});
