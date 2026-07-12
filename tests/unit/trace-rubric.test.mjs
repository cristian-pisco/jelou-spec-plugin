import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  QUALITY_SCHEMA,
  buildJudgePrompt,
  compositeScore,
  aggregatePanel,
} from '../../bin/lib/trace/rubric.mjs';

describe('QUALITY_SCHEMA', () => {
  test('is a strict object schema over the three dims plus rationale', () => {
    assert.equal(QUALITY_SCHEMA.type, 'object');
    assert.equal(QUALITY_SCHEMA.additionalProperties, false);
    assert.deepEqual(
      [...QUALITY_SCHEMA.required].sort(),
      ['correctness', 'faithfulness_to_spec', 'rationale', 'task_completion'],
    );
    for (const d of ['correctness', 'faithfulness_to_spec', 'task_completion']) {
      assert.equal(QUALITY_SCHEMA.properties[d].type, 'number');
    }
    assert.equal(QUALITY_SCHEMA.properties.rationale.type, 'string');
  });
});

describe('buildJudgePrompt({ agent_role, output, reference })', () => {
  test('embeds the output, the reference, and all three dimension names', () => {
    const prompt = buildJudgePrompt({
      agent_role: 'implementer',
      output: 'THE_AGENT_OUTPUT_MARKER',
      reference: 'THE_REFERENCE_MARKER',
    });
    assert.ok(prompt.includes('THE_AGENT_OUTPUT_MARKER'));
    assert.ok(prompt.includes('THE_REFERENCE_MARKER'));
    assert.ok(prompt.includes('correctness'));
    assert.ok(prompt.includes('faithfulness_to_spec'));
    assert.ok(prompt.includes('task_completion'));
  });

  test('instructs order- and length-neutral, reference-grounded judging', () => {
    const prompt = buildJudgePrompt({ output: 'x', reference: 'y' }).toLowerCase();
    assert.ok(prompt.includes('order'));
    assert.ok(prompt.includes('length'));
    assert.ok(prompt.includes('reference'));
  });

  test('is robust to a missing reference', () => {
    const prompt = buildJudgePrompt({ output: 'only-output' });
    assert.equal(typeof prompt, 'string');
    assert.ok(prompt.length > 0);
    assert.ok(prompt.includes('only-output'));
  });
});

describe('compositeScore(dims)', () => {
  test('is the mean of the three dimensions', () => {
    const s = compositeScore({ correctness: 0.9, faithfulness_to_spec: 0.6, task_completion: 0.9 });
    assert.ok(Math.abs(s - 0.8) < 1e-9);
    assert.equal(compositeScore({ correctness: 0.5, faithfulness_to_spec: 0.5, task_completion: 0.5 }), 0.5);
  });

  test('clamps out-of-range inputs into [0,1]', () => {
    assert.equal(
      compositeScore({ correctness: 5, faithfulness_to_spec: 5, task_completion: 5 }),
      1,
    );
    assert.equal(
      compositeScore({ correctness: -3, faithfulness_to_spec: -3, task_completion: -3 }),
      0,
    );
  });
});

describe('aggregatePanel(verdicts)', () => {
  const v = (c, f, t, rationale = 'r') => ({
    correctness: c,
    faithfulness_to_spec: f,
    task_completion: t,
    rationale,
  });

  test('single verdict → panel_agreement 1, no escalation, dims echo the verdict', () => {
    const r = aggregatePanel([v(0.8, 0.7, 0.9)]);
    assert.equal(r.n, 1);
    assert.equal(r.panel_agreement, 1);
    assert.equal(r.quality_dims.correctness, 0.8);
    assert.equal(r.quality_dims.faithfulness_to_spec, 0.7);
    assert.equal(r.quality_dims.task_completion, 0.9);
    assert.equal(r.escalate, false);
  });

  test('clustered verdicts → high agreement, no escalation', () => {
    const r = aggregatePanel([v(0.8, 0.8, 0.8), v(0.82, 0.78, 0.8), v(0.79, 0.81, 0.8)]);
    assert.ok(r.panel_agreement >= 0.7);
    assert.equal(r.escalate, false);
  });

  test('straddle branch: agreement stays high but a 0.5 straddle escalates', () => {
    const r = aggregatePanel([v(0.4, 0.4, 0.4), v(0.6, 0.6, 0.6)]);
    assert.ok(r.panel_agreement >= 0.7);
    assert.equal(r.escalate, true);
  });

  test('spread branch: wide disagreement drops agreement below 0.7 and escalates', () => {
    const r = aggregatePanel([v(0.05, 0.05, 0.05), v(0.95, 0.95, 0.95)]);
    assert.ok(r.panel_agreement < 0.7);
    assert.equal(r.escalate, true);
  });

  test('empty input → zeroed result that escalates', () => {
    const r = aggregatePanel([]);
    assert.equal(r.n, 0);
    assert.equal(r.quality_score, 0);
    assert.deepEqual(r.quality_dims, {
      correctness: 0,
      faithfulness_to_spec: 0,
      task_completion: 0,
    });
    assert.equal(r.escalate, true);
  });
});
