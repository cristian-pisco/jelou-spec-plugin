#!/usr/bin/env node
// bin/trace-suggest.mjs — scan recent traces, emit suggestion blocks on stdout.
// Surfacing is the caller's choice: workflows may print them (non-blocking) or
// prompt on them. immediate_flag findings are scoped to TRACE_CURRENT_TASK.
//
// Inputs (env):
//   TRACE_FILE                workspace spans.jsonl (default <cwd>/.traces/spans.jsonl)
//   FEEDBACK_FILE             feedback store (default feedback.jsonl beside TRACE_FILE)
//   TRACE_SUGGEST_HISTORY     cooldown store (default <cwd>/.spec-workspace/.cache/suggestion-history.jsonl)
//   TRACE_CURRENT_TASK        current task slug; limits immediate_flag to this task
//   TRACE_DISABLED=1          short-circuit (exit 0 silently)
//
// Output: one SUGGEST block per finding, an optional dormant-judge line, and a
// prediction-check section verifying prior approved predictions.
// Exit codes: 0 always (best-effort).

import { resolve, dirname, join } from 'node:path';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { readSpans, listRotatedFiles } from './lib/trace/reader.mjs';
import { pairSpans } from './lib/trace/aggregate.mjs';
import { readFeedback } from './lib/trace/feedback.mjs';
import {
  evaluate, applyCooldown, formatSuggestion, judgeCalibration, KAPPA_FLOOR,
} from './lib/trace/rules.mjs';
import { verifyPredictions } from './lib/trace/verify.mjs';
import { EVENT_KIND, EVAL_EVENT_NAME, MIN_SAMPLE } from './lib/trace/schema.mjs';

function resolveTraceFile() {
  return process.env.TRACE_FILE
    || resolve(process.cwd(), '.traces', 'spans.jsonl');
}

function resolveFeedbackFile(traceFile) {
  return process.env.FEEDBACK_FILE
    || join(dirname(traceFile), 'feedback.jsonl');
}

function resolveHistoryFile() {
  return process.env.TRACE_SUGGEST_HISTORY
    || resolve(process.cwd(), '.spec-workspace', '.cache', 'suggestion-history.jsonl');
}

function loadHistory(file) {
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function formatVerification(v) {
  const arrow = v.direction === 'increase' ? '≥' : '≤';
  return `prior [${v.rule_id}] ${v.signature}: predicted ${arrow}${Number(v.predicted_target).toFixed(2)} → ` +
    `actual ${Number(v.actual).toFixed(2)} ${v.met ? 'MET' : 'UNMET'}`;
}

function appendVerifications(file, verifications) {
  try {
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const lines = verifications.map(v => JSON.stringify({
      kind: 'verification',
      rule_id: v.rule_id,
      signature: v.signature,
      met: v.met,
      actual: v.actual,
      ts: new Date().toISOString(),
    }));
    appendFileSync(file, lines.join('\n') + '\n', 'utf8');
  } catch {
    return;
  }
}

if (process.env.TRACE_DISABLED === '1') process.exit(0);

const traceFile = resolveTraceFile();
const feedbackFile = resolveFeedbackFile(traceFile);
const historyFile = resolveHistoryFile();

const events = [];
for (const f of listRotatedFiles(traceFile)) {
  for (const e of readSpans(f)) events.push(e);
}

const pairs = pairSpans(events);
const feedback = readFeedback(feedbackFile);
const currentTask = process.env.TRACE_CURRENT_TASK || undefined;
const findings = evaluate(pairs, { events, feedback, currentTask });
const history = loadHistory(historyFile);
const filtered = applyCooldown(findings, history);

const sections = [];

if (filtered.length > 0) {
  sections.push(filtered.map(formatSuggestion).join('\n\n'));
}

const hasEvalEvents = events.some(
  e => e.event_kind === EVENT_KIND.EVENT && e.name === EVAL_EVENT_NAME,
);
if (hasEvalEvents) {
  const cal = judgeCalibration({ events, feedback });
  if (!cal.calibrated) {
    sections.push(
      `quality rules dormant: judge uncalibrated (kappa=${cal.kappa.toFixed(2)}, ` +
      `pairs=${cal.pairs}, need kappa>=${KAPPA_FLOOR} & pairs>=${MIN_SAMPLE})`,
    );
  }
}

const verifications = verifyPredictions(pairs, history, { now: Date.now() });
if (verifications.length > 0) {
  sections.push(['prediction check:', ...verifications.map(formatVerification)].join('\n'));
  appendVerifications(historyFile, verifications);
}

if (sections.length === 0) process.exit(0);

process.stdout.write(sections.join('\n\n') + '\n');
