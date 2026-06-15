// tests/unit/investigate.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { slugify, parseArgs } from '../../bin/investigate.mjs';

describe('slugify', () => {
  test('lowercases, hyphenates, strips symbols, caps at 40', () => {
    const s = slugify('¿gRPC vs REST a escala?? Sí ' + 'x'.repeat(100));
    assert.match(s, /^[a-z0-9-]+$/);
    assert.ok(s.length <= 40);
    assert.ok(!s.startsWith('-') && !s.endsWith('-'));
  });

  test('same topic yields the same slug (deterministic resume key)', () => {
    assert.equal(slugify('gRPC vs REST'), slugify('gRPC vs REST'));
  });
});

describe('parseArgs', () => {
  test('topic positional, engine defaults to perplexity', () => {
    const a = parseArgs(['¿X?']);
    assert.equal(a.topic, '¿X?');
    assert.equal(a.engine, 'perplexity');
  });

  test('--engine fusion is honored', () => {
    const a = parseArgs(['¿X?', '--engine', 'fusion']);
    assert.equal(a.engine, 'fusion');
  });

  test('rejects unknown engine', () => {
    assert.throws(() => parseArgs(['¿X?', '--engine', 'bogus']), /unknown engine/);
  });
});
