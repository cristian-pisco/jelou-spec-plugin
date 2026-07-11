// tests/unit/trace-cost.test.mjs
//
// Run: `node --test tests/unit/trace-cost.test.mjs`
//
// Best-effort USD cost derivation from token counts + model tier.

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { PRICES, normalizeModel, deriveCost } from '../../bin/lib/trace/cost.mjs';

describe('normalizeModel(model)', () => {
  test('maps bare tier names', () => {
    assert.equal(normalizeModel('opus'), 'opus');
    assert.equal(normalizeModel('Sonnet'), 'sonnet');
    assert.equal(normalizeModel('HAIKU'), 'haiku');
  });

  test('maps full model ids by substring', () => {
    assert.equal(normalizeModel('claude-opus-4-8'), 'opus');
    assert.equal(normalizeModel('claude-3-5-haiku-20241022'), 'haiku');
    assert.equal(normalizeModel('anthropic/claude-sonnet-5'), 'sonnet');
  });

  test('unknown model returns null', () => {
    assert.equal(normalizeModel('gpt-5.5'), null);
    assert.equal(normalizeModel(''), null);
    assert.equal(normalizeModel(undefined), null);
  });
});

describe('deriveCost(model, tokensIn, tokensOut)', () => {
  test('computes tokens/1e6 * per-million price for each direction', () => {
    assert.equal(deriveCost('sonnet', 1_000_000, 1_000_000),
      PRICES.sonnet.input + PRICES.sonnet.output);
  });

  test('scales sub-million token counts', () => {
    const expected = (100_000 / 1e6) * PRICES.opus.input + (50_000 / 1e6) * PRICES.opus.output;
    assert.equal(deriveCost('claude-opus-4-8', 100_000, 50_000), Number(expected.toFixed(6)));
  });

  test('zero output tokens still prices input', () => {
    assert.equal(deriveCost('haiku', 1_000_000, 0), PRICES.haiku.input);
  });

  test('unknown model yields null (distinct from 0 / free)', () => {
    assert.equal(deriveCost('gpt-5.5', 100, 100), null);
  });

  test('missing / non-numeric tokens yield null', () => {
    assert.equal(deriveCost('sonnet', null, 100), null);
    assert.equal(deriveCost('sonnet', 100, undefined), null);
    assert.equal(deriveCost('sonnet', 'x', 100), null);
  });
});

describe('PRICES table', () => {
  test('carries opus / sonnet / haiku with input+output rates and is frozen', () => {
    for (const tier of ['opus', 'sonnet', 'haiku']) {
      assert.equal(typeof PRICES[tier].input, 'number');
      assert.equal(typeof PRICES[tier].output, 'number');
    }
    assert.ok(Object.isFrozen(PRICES));
  });
});
