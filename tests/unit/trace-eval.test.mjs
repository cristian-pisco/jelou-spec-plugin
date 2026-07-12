import { test, describe, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEval, EVAL_DEFAULT_MODELS, formatEvalSummary } from '../../bin/trace-eval.mjs';

const JUDGED = {
  event_kind: 'span_start',
  span_id: 'SPANJUDGED00000000000000001',
  trace_id: 'TRACE000000000000000000001',
  scope: 'task',
  name: 'agent_dispatch',
  task_slug: 'demo-task',
  agent_role: 'implementer',
  ts: '2026-07-11T00:00:00Z',
};

function makeTrace() {
  const dir = mkdtempSync(join(tmpdir(), 'trace-eval-'));
  const file = join(dir, 'spans.jsonl');
  writeFileSync(file, JSON.stringify(JUDGED) + '\n', 'utf8');
  return { dir, file };
}

function evalEvents(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.event_kind === 'event' && e.name === 'eval');
}

function okResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function stubVerdict(verdict) {
  return async () => okResponse(JSON.stringify(verdict));
}

const GOOD = { correctness: 0.9, faithfulness_to_spec: 0.8, task_completion: 0.85, rationale: 'looks good' };

describe('runEval', () => {
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    delete process.env.TRACE_DISABLED;
    delete process.env.EVAL_DISABLED;
  });

  test('emits exactly one eval event with correct parent/trace/attrs', async () => {
    const { dir, file } = makeTrace();
    dirs.push(dir);
    const summary = await runEval({
      traceFile: file,
      spanId: JUDGED.span_id,
      models: ['openai/gpt-5.5'],
      apiKey: 'test-key',
      output: 'some agent output',
      reference: 'SPEC content',
      fetchImpl: stubVerdict(GOOD),
    });

    const events = evalEvents(file);
    assert.equal(events.length, 1);
    const e = events[0];
    assert.equal(e.event_kind, 'event');
    assert.equal(e.name, 'eval');
    assert.equal(e.parent_span_id, JUDGED.span_id);
    assert.equal(e.trace_id, JUDGED.trace_id);
    assert.equal(e.scope, 'task');
    assert.equal(e.task_slug, 'demo-task');
    assert.ok(e.span_id && e.span_id !== JUDGED.span_id);
    assert.equal(e.attrs.evaluator, 'openai/gpt-5.5');
    assert.ok(e.attrs.quality_score > 0.8 && e.attrs.quality_score <= 0.9);
    assert.equal(e.attrs.quality_dims.correctness, 0.9);
    assert.equal(e.attrs.panel_agreement, 1);
    assert.equal(e.attrs.escalate, false);
    assert.equal(e.attrs.rationale, 'looks good');
    assert.equal(summary.scored.length, 1);
    assert.equal(summary.skipped.length, 0);
  });

  test('EVAL_DISABLED=1 → no event, empty summary', async () => {
    const { dir, file } = makeTrace();
    dirs.push(dir);
    process.env.EVAL_DISABLED = '1';
    const summary = await runEval({
      traceFile: file,
      spanId: JUDGED.span_id,
      models: ['m'],
      apiKey: 'k',
      output: 'o',
      reference: 'r',
      fetchImpl: stubVerdict(GOOD),
    });
    assert.equal(evalEvents(file).length, 0);
    assert.deepEqual(summary, { scored: [], skipped: [] });
  });

  test('TRACE_DISABLED=1 → no event', async () => {
    const { dir, file } = makeTrace();
    dirs.push(dir);
    process.env.TRACE_DISABLED = '1';
    const summary = await runEval({
      traceFile: file,
      spanId: JUDGED.span_id,
      models: ['m'],
      apiKey: 'k',
      output: 'o',
      reference: 'r',
      fetchImpl: stubVerdict(GOOD),
    });
    assert.equal(evalEvents(file).length, 0);
    assert.deepEqual(summary, { scored: [], skipped: [] });
  });

  test('missing apiKey → no event, returns without throwing', async () => {
    const { dir, file } = makeTrace();
    dirs.push(dir);
    const summary = await runEval({
      traceFile: file,
      spanId: JUDGED.span_id,
      models: ['m'],
      apiKey: '',
      output: 'o',
      reference: 'r',
      fetchImpl: stubVerdict(GOOD),
    });
    assert.equal(evalEvents(file).length, 0);
    assert.deepEqual(summary, { scored: [], skipped: [] });
  });

  test('HTTP 400 then free-text JSON still parses (fallback path)', async () => {
    const { dir, file } = makeTrace();
    dirs.push(dir);
    const verdict = { correctness: 0.7, faithfulness_to_spec: 0.7, task_completion: 0.7, rationale: 'fallback ok' };
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 400, text: async () => 'schema rejected' };
      return okResponse('```json\n' + JSON.stringify(verdict) + '\n```');
    };
    await runEval({
      traceFile: file,
      spanId: JUDGED.span_id,
      models: ['openai/gpt-5.5'],
      apiKey: 'k',
      output: 'o',
      reference: 'r',
      fetchImpl,
    });
    const events = evalEvents(file);
    assert.equal(events.length, 1);
    assert.ok(Math.abs(events[0].attrs.quality_score - 0.7) < 1e-9);
    assert.ok(calls >= 2);
  });

  test('panel straddling 0.5 → escalate true', async () => {
    const { dir, file } = makeTrace();
    dirs.push(dir);
    const high = { correctness: 0.9, faithfulness_to_spec: 0.9, task_completion: 0.9, rationale: 'hi' };
    const low = { correctness: 0.1, faithfulness_to_spec: 0.1, task_completion: 0.1, rationale: 'lo' };
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return okResponse(JSON.stringify(calls === 1 ? high : low));
    };
    await runEval({
      traceFile: file,
      spanId: JUDGED.span_id,
      models: ['openai/gpt-5.5', 'google/gemini-3.1-pro-preview'],
      apiKey: 'k',
      output: 'o',
      reference: 'r',
      fetchImpl,
    });
    const events = evalEvents(file);
    assert.equal(events.length, 1);
    assert.equal(events[0].attrs.escalate, true);
    assert.equal(events[0].attrs.evaluator, 'openai/gpt-5.5,google/gemini-3.1-pro-preview');
  });

  test('span not present in the trace → skipped, no event', async () => {
    const { dir, file } = makeTrace();
    dirs.push(dir);
    const summary = await runEval({
      traceFile: file,
      spanId: 'NOSUCHSPAN0000000000000000',
      models: ['m'],
      apiKey: 'k',
      output: 'o',
      reference: 'r',
      fetchImpl: stubVerdict(GOOD),
    });
    assert.equal(evalEvents(file).length, 0);
    assert.equal(summary.scored.length, 0);
  });

  test('EVAL_DEFAULT_MODELS is a small cross-family panel with no same-family self-judge', () => {
    assert.ok(Array.isArray(EVAL_DEFAULT_MODELS));
    assert.ok(EVAL_DEFAULT_MODELS.length >= 2);
    assert.ok(!EVAL_DEFAULT_MODELS.some((m) => /anthropic|claude/i.test(m)));
  });
});

describe('formatEvalSummary', () => {
  test('empty run reports that nothing matched', () => {
    assert.equal(formatEvalSummary({ scored: [], skipped: [] }), 'trace-eval: no judgeable spans matched');
    assert.equal(formatEvalSummary({}), 'trace-eval: no judgeable spans matched');
    assert.equal(formatEvalSummary(null), 'trace-eval: no judgeable spans matched');
  });

  test('scored-only run reports the count', () => {
    const summary = { scored: [{ escalate: false }, { escalate: false }], skipped: [] };
    assert.equal(formatEvalSummary(summary), 'trace-eval: scored 2');
  });

  test('surfaces escalations among scored spans', () => {
    const summary = { scored: [{ escalate: true }, { escalate: false }, { escalate: true }], skipped: [] };
    assert.equal(formatEvalSummary(summary), 'trace-eval: scored 3, 2 escalated');
  });

  test('all spans skipped for no_verdicts is visible, not silent (the stale-slug case)', () => {
    const summary = {
      scored: [],
      skipped: [{ reason: 'no_verdicts' }, { reason: 'no_verdicts' }, { reason: 'no_verdicts' }],
    };
    assert.equal(formatEvalSummary(summary), 'trace-eval: scored 0, skipped 3 (no_verdicts=3)');
  });

  test('breaks skip reasons down and sorts them deterministically', () => {
    const summary = {
      scored: [{ escalate: false }],
      skipped: [{ reason: 'no_output' }, { reason: 'sampled_out' }, { reason: 'no_output' }],
    };
    assert.equal(formatEvalSummary(summary), 'trace-eval: scored 1, skipped 3 (no_output=2, sampled_out=1)');
  });

  test('missing skip reason falls back to unknown', () => {
    const summary = { scored: [], skipped: [{}, { reason: 'no_output' }] };
    assert.equal(formatEvalSummary(summary), 'trace-eval: scored 0, skipped 2 (no_output=1, unknown=1)');
  });
});
