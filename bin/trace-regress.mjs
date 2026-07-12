#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadGolden, detectRegression } from './lib/trace/regress.mjs';
import { buildJudgePrompt, aggregatePanel, QUALITY_SCHEMA } from './lib/trace/rubric.mjs';
import { chatCompletion } from './lib/openrouter.mjs';
import { EVAL_DEFAULT_MODELS, parseVerdict } from './trace-eval.mjs';

const JUDGE_TIMEOUT_MS = 90_000;
const DEFAULT_GOLDEN_DIR = 'tests/golden';
const DEFAULT_BASELINE = 'tests/golden/baseline.json';
const REGRESSION_EXIT = 4;

async function judgeExample(example, { apiKey, models, fetchImpl }) {
  const prompt = buildJudgePrompt({
    agent_role: example.agent_role,
    output: example.output,
    reference: example.reference,
  });
  const responseFormat = {
    type: 'json_schema',
    json_schema: { name: 'quality_verdict', strict: true, schema: QUALITY_SCHEMA },
  };
  const settled = await Promise.allSettled(models.map(async (model) => {
    const base = { model, prompt, apiKey, timeoutMs: JUDGE_TIMEOUT_MS, fetchImpl };
    let result = await chatCompletion({ ...base, responseFormat });
    if (!result.ok && result.httpStatus === 400) {
      result = await chatCompletion({ ...base, responseFormat: null });
    }
    return result.ok ? parseVerdict(result.content) : null;
  }));
  const verdicts = settled.filter((s) => s.status === 'fulfilled' && s.value).map((s) => s.value);
  if (verdicts.length === 0) return null;
  return aggregatePanel(verdicts).quality_score;
}

function readBaseline(file) {
  if (!file || !existsSync(file)) return {};
  try {
    const obj = JSON.parse(readFileSync(file, 'utf8'));
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function writeBaseline(file, map) {
  writeFileSync(file, JSON.stringify(map, null, 2) + '\n', 'utf8');
}

export async function runRegress({
  goldenDir,
  baselineFile,
  scoreFn,
  margin = 0.05,
  perExampleMargin = 0.15,
  updateBaseline = false,
  apiKey,
  models = EVAL_DEFAULT_MODELS,
  fetchImpl = fetch,
} = {}) {
  const hasScorer = typeof scoreFn === 'function';
  if (!hasScorer && (!apiKey || !String(apiKey).trim())) {
    return { skipped: true, reason: 'no OPENROUTER_API_KEY' };
  }

  const score = hasScorer
    ? scoreFn
    : (example) => judgeExample(example, { apiKey, models, fetchImpl });

  const current = {};
  for (const example of loadGolden(goldenDir)) {
    let value;
    try {
      value = await score(example);
    } catch {
      continue;
    }
    const n = Number(value);
    if (Number.isFinite(n)) current[example.id] = n;
  }

  if (updateBaseline) {
    writeBaseline(baselineFile, current);
    return { updated: true };
  }

  const baseline = readBaseline(baselineFile);
  return detectRegression(current, baseline, { margin, perExampleMargin });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--golden-dir') out.goldenDir = argv[++i];
    else if (arg === '--baseline') out.baselineFile = argv[++i];
    else if (arg === '--margin') out.margin = Number(argv[++i]);
    else if (arg === '--per-example-margin') out.perExampleMargin = Number(argv[++i]);
    else if (arg === '--update-baseline') out.updateBaseline = true;
  }
  return out;
}

function scoreFnFromEnv() {
  const file = process.env.TRACE_REGRESS_SCORES;
  if (!file || !existsSync(file)) return null;
  let map;
  try {
    map = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!map || typeof map !== 'object') return null;
  return (example) => Promise.resolve(Number(map[example.id]));
}

function fmt(x) {
  return Number.isFinite(x) ? x.toFixed(3) : 'n/a';
}

function printReport(result) {
  const droppedIds = result.per_example.filter((e) => e.delta < 0).map((e) => e.id);
  const lines = [
    `trace-regress: mean current ${fmt(result.mean_current)} vs baseline ${fmt(result.mean_baseline)} (delta ${fmt(result.delta)})`,
    `trace-regress: paired ${result.per_example.length}, improved ${result.improved}, dropped ${result.dropped}`,
  ];
  if (droppedIds.length > 0) lines.push(`trace-regress: dropped ids ${droppedIds.join(', ')}`);
  lines.push(result.regressed
    ? `trace-regress: REGRESSION vs golden baseline — exit ${REGRESSION_EXIT} (advisory).`
    : 'trace-regress: no regression vs golden baseline.');
  process.stdout.write(lines.join('\n') + '\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const goldenDir = resolve(args.goldenDir || DEFAULT_GOLDEN_DIR);
  const baselineFile = resolve(args.baselineFile || DEFAULT_BASELINE);
  const margin = Number.isFinite(args.margin) ? args.margin : 0.05;
  const perExampleMargin = Number.isFinite(args.perExampleMargin) ? args.perExampleMargin : 0.15;

  let result;
  try {
    result = await runRegress({
      goldenDir,
      baselineFile,
      scoreFn: scoreFnFromEnv() || undefined,
      margin,
      perExampleMargin,
      updateBaseline: Boolean(args.updateBaseline),
      apiKey: process.env.OPENROUTER_API_KEY,
    });
  } catch (err) {
    process.stderr.write(`trace-regress: ${String(err?.message || err)} — skipping (advisory, non-blocking).\n`);
    process.exit(0);
  }

  if (result.skipped) {
    process.stderr.write(`trace-regress: ${result.reason} — skipping golden regression gate (advisory, exit 0).\n`);
    process.exit(0);
  }
  if (result.updated) {
    process.stdout.write(`trace-regress: baseline updated at ${baselineFile}.\n`);
    process.exit(0);
  }

  printReport(result);
  process.exit(result.regressed ? REGRESSION_EXIT : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
