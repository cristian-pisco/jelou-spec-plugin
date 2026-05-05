// bin/lib/dev-orchestrator/diagnose.mjs
//
// Build the structured input the diagnoser agent consumes; parse its
// structured output. No model invocation here — the workflow dispatches
// the agent.

import { readFileSync, existsSync } from 'node:fs';

const DEFAULT_TEMPLATE = ['docker compose -f {compose_file}', 'exec', '{compose_service} {cmd}'].join(' ');

export function readRecentEvents({ logPath, service, limit = 50 }) {
  if (!existsSync(logPath)) return [];
  const body = readFileSync(logPath, 'utf8');
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line);
      if (evt.service === service) out.push(evt);
    } catch { /* skip bad line */ }
  }
  return out.slice(-limit);
}

export function buildDiagnoseInput({ service, events, capture, allServices, os, workspaceRoot }) {
  const deps = service.depends_on || [];
  const resolved = deps
    .map((name) => (allServices || []).find((s) => s.name === name))
    .filter(Boolean);
  return {
    service,
    events,
    capture,
    depends_on_resolved: resolved,
    os,
    workspaceRoot
  };
}

export function parseDiagnoseOutput(raw) {
  let body = String(raw).trim();
  const m = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (m) body = m[1].trim();
  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== 'object') throw new Error('diagnose output: not an object');
  for (const required of ['cause', 'confidence', 'evidence']) {
    if (!(required in parsed)) throw new Error(`diagnose output: missing field "${required}"`);
  }
  return parsed;
}

export function substituteFix({ service, fix }) {
  if (!fix) return null;
  if (fix.runs_in !== 'container') return fix.command;
  const r = service.runtime || {};
  const tmpl = r.exec_template || DEFAULT_TEMPLATE;
  return tmpl
    .replace(/\{compose_file\}/g, r.compose_file || './docker-compose.yml')
    .replace(/\{compose_service\}/g, r.compose_service || '')
    .replace(/\{cmd\}/g, fix.command);
}
