// tests/unit/dev-orchestrator-patterns-matcher.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { compilePatterns, matchLines, Cooldown } from '../../bin/lib/dev-orchestrator/patterns-matcher.mjs';

describe('compilePatterns', () => {
  test('compiles each string with i flag', () => {
    const c = compilePatterns(['EADDRINUSE', 'cannot find module']);
    assert.equal(c.length, 2);
    assert.ok(c[0].regex.test('something EADDRINUSE happened'));
    assert.ok(c[1].regex.test('Error: Cannot find module ...'));
  });
  test('throws on bad regex', () => {
    assert.throws(() => compilePatterns(['[unclosed']));
  });
});

describe('matchLines', () => {
  test('returns one entry per match', () => {
    const c = compilePatterns(['EADDRINUSE', 'cannot find module']);
    const hits = matchLines(c, [
      'starting',
      'Error: EADDRINUSE: address already in use',
      'Error: Cannot find module foo',
      'unrelated'
    ]);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].pattern, 'EADDRINUSE');
    assert.equal(hits[1].pattern, 'cannot find module');
  });

  test('matches multiple patterns on the same line', () => {
    const c = compilePatterns(['EADDRINUSE', 'address']);
    const hits = matchLines(c, ['Error: EADDRINUSE address']);
    assert.equal(hits.length, 2);
  });
});

describe('Cooldown', () => {
  test('allows first call, blocks within window', () => {
    const cd = Cooldown(60);
    assert.equal(cd.allow('a:hard'), true);
    assert.equal(cd.allow('a:hard'), false);
    assert.equal(cd.allow('a:soft'), true);  // different key
  });
  test('reset clears all keys', () => {
    const cd = Cooldown(60);
    cd.allow('x');
    cd.reset();
    assert.equal(cd.allow('x'), true);
  });
});
