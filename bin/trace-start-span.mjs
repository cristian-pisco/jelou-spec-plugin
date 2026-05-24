#!/usr/bin/env node
// bin/trace-start-span.mjs — emit a span_start, print {span_id, trace_id, parent}.
//
// Inputs (CLI flags, kebab-case):
//   --name <span name>         REQUIRED (e.g., execute_task, phase, agent_dispatch)
//   --scope <task|daemon|global>  REQUIRED
//   --parent <span_id>         optional — sets parent_span_id
//   --trace <trace_id>         optional — when set, inherits this trace; required with --parent
//   --task <slug>              optional — task_slug attribute
//   --service <id>             optional — service_id attribute
//   --phase <num>              optional — phase_num attribute
//   --agent <role>             optional — agent_role attribute (for agent_dispatch)
//   --model <model>            optional — attrs.model_used (for agent_dispatch)
//
// Environment:
//   TRACE_FILE   absolute path to spans.jsonl. If unset, resolves to
//                <cwd>/.traces/spans.jsonl.
//   TRACE_DISABLED=1   short-circuit: exit 0 with empty ids printed.
//
// Output (stdout, single JSON line):
//   {"span_id":"01HX...","trace_id":"01HX...","parent":"01HX..."|null}
//
// Exit codes:
//   0  span emitted (or TRACE_DISABLED)
//   1  invalid args

import { resolve } from 'node:path';
import { startSpan } from './lib/trace/emitter.mjs';
import { SCOPE } from './lib/trace/schema.mjs';

const VALID_SCOPES = new Set(Object.values(SCOPE));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    out[key] = argv[++i];
  }
  return out;
}

function die(msg) {
  process.stderr.write(`trace-start-span: ${msg}\n`);
  process.exit(1);
}

function resolveTraceFile() {
  if (process.env.TRACE_FILE) return process.env.TRACE_FILE;
  return resolve(process.cwd(), '.traces', 'spans.jsonl');
}

const args = parseArgs(process.argv.slice(2));

if (process.env.TRACE_DISABLED === '1') {
  process.stdout.write(JSON.stringify({ span_id: '', trace_id: '', parent: null }) + '\n');
  process.exit(0);
}

if (!args.name) die('--name required');
if (!args.scope) die('--scope required');
if (!VALID_SCOPES.has(args.scope)) {
  die(`--scope must be one of ${[...VALID_SCOPES].join(', ')}`);
}
if (args.parent && !args.trace) {
  die('--trace required when --parent is set');
}

const phaseNum = args.phase != null ? Number(args.phase) : undefined;
if (args.phase != null && Number.isNaN(phaseNum)) die('--phase must be a number');

const attrs = {};
if (args.model) attrs.model_used = args.model;

const r = startSpan(resolveTraceFile(), {
  scope: args.scope,
  name: args.name,
  parent_span_id: args.parent || undefined,
  trace_id: args.trace || undefined,
  task_slug: args.task || undefined,
  service_id: args.service || undefined,
  phase_num: phaseNum,
  agent_role: args.agent || undefined,
  attrs: Object.keys(attrs).length ? attrs : undefined,
});

process.stdout.write(JSON.stringify({
  span_id: r.span_id,
  trace_id: r.trace_id,
  parent: r.parent_span_id,
}) + '\n');
