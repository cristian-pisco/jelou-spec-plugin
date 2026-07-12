#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import { appendSpan, ulid } from './lib/trace/emitter.mjs';
import { EVENT_KIND, SCOPE, EVAL_EVENT_NAME, PAYLOAD_CAP_BYTES } from './lib/trace/schema.mjs';
import { chatCompletion } from './lib/openrouter.mjs';
import { QUALITY_SCHEMA, buildJudgePrompt, aggregatePanel } from './lib/trace/rubric.mjs';

export const EVAL_DEFAULT_MODELS = [
  'openai/gpt-5.5',
  'google/gemini-3.1-pro-preview',
  'deepseek/deepseek-v4-pro',
];

const EVAL_TIMEOUT_MS = 90_000;
const JUDGEABLE_SPANS = new Set(['phase', 'agent_dispatch', 'execute_task']);
const NUMERIC_DIMS = ['correctness', 'faithfulness_to_spec', 'task_completion'];

function disabled() {
  return process.env.TRACE_DISABLED === '1' || process.env.EVAL_DISABLED === '1';
}

function readAllEvents(traceFile) {
  const events = [];
  for (const file of listRotatedFiles(traceFile)) {
    for (const event of readSpans(file)) events.push(event);
  }
  return events;
}

function resolveTargetSpans(events, { spanId, taskSlug }) {
  const starts = events.filter((e) => e.event_kind === EVENT_KIND.SPAN_START);
  if (spanId) return starts.filter((e) => e.span_id === spanId);
  if (taskSlug) {
    return starts.filter((e) => e.task_slug === taskSlug && JUDGEABLE_SPANS.has(e.name));
  }
  return [];
}

function resolveOutput({ output, span, cwd }) {
  if (output != null && String(output).trim()) return String(output);
  if (!span.service_id || span.phase_num == null) return null;
  const reportsDir = join(
    cwd,
    'services',
    String(span.service_id),
    'phases',
    `${String(span.phase_num).padStart(2, '0')}-reports`,
  );
  if (!existsSync(reportsDir)) return null;
  try {
    const files = readdirSync(reportsDir).filter((f) => f.endsWith('.md'));
    if (files.length === 0) return null;
    return files.map((f) => readFileSync(join(reportsDir, f), 'utf8')).join('\n\n');
  } catch {
    return null;
  }
}

export function parseVerdict(text) {
  if (!text || !String(text).trim()) return null;
  const raw = String(text);
  const attempts = [raw.trim()];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) attempts.push(fenced[1].trim());
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) attempts.push(raw.slice(first, last + 1));

  for (const candidate of attempts) {
    let obj;
    try {
      obj = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (obj && typeof obj === 'object' && NUMERIC_DIMS.every((k) => typeof obj[k] === 'number')) {
      return obj;
    }
  }
  return null;
}

async function judgeWithModel({ model, prompt, apiKey, fetchImpl }) {
  const responseFormat = {
    type: 'json_schema',
    json_schema: { name: 'quality_verdict', strict: true, schema: QUALITY_SCHEMA },
  };
  const base = { model, prompt, apiKey, timeoutMs: EVAL_TIMEOUT_MS, fetchImpl };
  let result = await chatCompletion({ ...base, responseFormat });
  if (!result.ok && result.httpStatus === 400) {
    result = await chatCompletion({ ...base, responseFormat: null });
  }
  if (!result.ok) return null;
  return parseVerdict(result.content);
}

function truncateRationale(rationale, event) {
  const probe = {
    ts: new Date().toISOString(),
    ...event,
    attrs: { ...event.attrs, rationale: '' },
  };
  const baseBytes = Buffer.byteLength(JSON.stringify(probe), 'utf8');
  const budget = PAYLOAD_CAP_BYTES - baseBytes - 32;
  const text = String(rationale || '');
  if (budget <= 0) return '';
  if (Buffer.byteLength(text, 'utf8') <= budget) return text;
  return text.slice(0, budget);
}

export async function runEval({
  traceFile,
  feedbackFile,
  spanId,
  taskSlug,
  models = EVAL_DEFAULT_MODELS,
  apiKey,
  output,
  reference,
  fetchImpl = fetch,
  sampleRate = 1.0,
  cwd = process.cwd(),
} = {}) {
  const summary = { scored: [], skipped: [] };
  if (disabled()) return summary;

  if (!apiKey || !String(apiKey).trim()) {
    process.stderr.write('trace-eval: OPENROUTER_API_KEY missing — cannot judge, skipping.\n');
    return summary;
  }

  const panelModels = Array.isArray(models) && models.length > 0 ? models : EVAL_DEFAULT_MODELS;
  const events = readAllEvents(traceFile);
  const targets = resolveTargetSpans(events, { spanId, taskSlug });

  for (const span of targets) {
    if (Math.random() >= sampleRate) {
      summary.skipped.push({ span_id: span.span_id, reason: 'sampled_out' });
      continue;
    }

    const resolvedOutput = resolveOutput({ output, span, cwd });
    if (!resolvedOutput) {
      summary.skipped.push({ span_id: span.span_id, reason: 'no_output' });
      continue;
    }

    const prompt = buildJudgePrompt({ agent_role: span.agent_role, output: resolvedOutput, reference });
    const settled = await Promise.allSettled(
      panelModels.map((model) => judgeWithModel({ model, prompt, apiKey, fetchImpl })),
    );
    const verdicts = settled
      .filter((s) => s.status === 'fulfilled' && s.value)
      .map((s) => s.value);

    if (verdicts.length === 0) {
      summary.skipped.push({ span_id: span.span_id, reason: 'no_verdicts' });
      continue;
    }

    const panel = aggregatePanel(verdicts);
    const event = {
      event_kind: EVENT_KIND.EVENT,
      name: EVAL_EVENT_NAME,
      span_id: ulid(),
      parent_span_id: span.span_id,
      trace_id: span.trace_id,
      scope: SCOPE.TASK,
      task_slug: span.task_slug,
      attrs: {
        evaluator: panelModels.join(','),
        quality_score: panel.quality_score,
        quality_dims: panel.quality_dims,
        panel_agreement: panel.panel_agreement,
        escalate: panel.escalate,
      },
    };
    event.attrs.rationale = truncateRationale(verdicts[0].rationale, event);
    appendSpan(traceFile, event);

    summary.scored.push({
      span_id: span.span_id,
      quality_score: panel.quality_score,
      panel_agreement: panel.panel_agreement,
      escalate: panel.escalate,
      n: panel.n,
    });
  }

  return summary;
}

export function formatEvalSummary(summary) {
  const scored = Array.isArray(summary?.scored) ? summary.scored : [];
  const skipped = Array.isArray(summary?.skipped) ? summary.skipped : [];
  if (scored.length === 0 && skipped.length === 0) {
    return 'trace-eval: no judgeable spans matched';
  }
  const parts = [`scored ${scored.length}`];
  const escalated = scored.filter((s) => s && s.escalate).length;
  if (escalated > 0) parts.push(`${escalated} escalated`);
  if (skipped.length > 0) {
    const byReason = {};
    for (const s of skipped) {
      const reason = (s && s.reason) || 'unknown';
      byReason[reason] = (byReason[reason] || 0) + 1;
    }
    const breakdown = Object.keys(byReason)
      .sort()
      .map((reason) => `${reason}=${byReason[reason]}`)
      .join(', ');
    parts.push(`skipped ${skipped.length} (${breakdown})`);
  }
  return `trace-eval: ${parts.join(', ')}`;
}

function resolveTraceFile() {
  if (process.env.TRACE_FILE) return process.env.TRACE_FILE;
  return resolve(process.cwd(), '.traces', 'spans.jsonl');
}

function resolveFeedbackFile(traceFile) {
  if (process.env.FEEDBACK_FILE) return process.env.FEEDBACK_FILE;
  return join(dirname(traceFile), 'feedback.jsonl');
}

export function parseArgs(argv) {
  const out = { sampleRate: 1.0 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--span') out.span = argv[++i];
    else if (arg === '--task') out.task = argv[++i];
    else if (arg === '--models') out.models = argv[++i];
    else if (arg === '--output') out.output = argv[++i];
    else if (arg === '--reference') out.reference = argv[++i];
    else if (arg === '--sample-rate') out.sampleRate = Number(argv[++i]);
  }
  return out;
}

function readMaybeFile(value) {
  if (value == null) return value;
  return existsSync(value) ? readFileSync(value, 'utf8') : value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.span && !args.task) {
    process.stderr.write('trace-eval: --span <id> or --task <slug> required\n');
    process.exit(1);
  }

  const traceFile = resolveTraceFile();
  const feedbackFile = resolveFeedbackFile(traceFile);
  const models = args.models
    ? args.models.split(',').map((s) => s.trim()).filter(Boolean)
    : EVAL_DEFAULT_MODELS;

  const summary = await runEval({
    traceFile,
    feedbackFile,
    spanId: args.span,
    taskSlug: args.task,
    models,
    apiKey: process.env.OPENROUTER_API_KEY,
    output: readMaybeFile(args.output),
    reference: readMaybeFile(args.reference),
    sampleRate: Number.isFinite(args.sampleRate) ? args.sampleRate : 1.0,
  });

  if (!disabled()) process.stderr.write(formatEvalSummary(summary) + '\n');
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
