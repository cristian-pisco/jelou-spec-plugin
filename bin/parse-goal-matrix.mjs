#!/usr/bin/env node

import { argv, stdout, stderr, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.0';

const LEVEL_ALIASES = {
  frontend: 'frontend',
  front: 'frontend',
  ui: 'frontend',
  backend: 'backend',
  back: 'backend',
  api: 'backend',
  fullstack: 'fullstack',
  full: 'fullstack',
  'full-stack': 'fullstack',
};
const LEVEL_TAG_RE = /\[\s*([a-z-]+)\s*\]/gi;
const SERVICE_TAG_RE = /@([a-z0-9][a-z0-9-]*)/gi;
const CRITERION_RE = /=>\s*(.+)$/;
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;

const BOOLEAN_FLAGS = ['force', 'allow-shared-data', 'allow-prod-target'];
const VALUE_FLAGS = ['task', 'max-iterations', 'workers'];

function extractFlags(input) {
  const flags = {};
  let rest = input;
  for (const name of VALUE_FLAGS) {
    const re = new RegExp(`--${name}=(\\S+)`, 'g');
    rest = rest.replace(re, (_, value) => {
      flags[name] = value;
      return '';
    });
  }
  for (const name of BOOLEAN_FLAGS) {
    const re = new RegExp(`--${name}(?=\\s|$)`, 'g');
    rest = rest.replace(re, () => {
      flags[name] = true;
      return '';
    });
  }
  if (flags['max-iterations'] !== undefined) {
    const n = Number(flags['max-iterations']);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error('parse-goal-matrix: --max-iterations must be a positive integer');
    }
    flags['max-iterations'] = n;
  }
  if (flags.workers !== undefined) {
    const n = Number(flags.workers);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error('parse-goal-matrix: --workers must be a positive integer');
    }
    flags.workers = n;
  }
  return { flags, rest: rest.trim() };
}

function normalizeLevel(raw) {
  if (typeof raw !== 'string') return null;
  return LEVEL_ALIASES[raw.trim().toLowerCase()] ?? null;
}

function parseTextObjective(line) {
  let title = line;
  let level = null;
  const services = [];
  let success_criteria = '';

  title = title.replace(LEVEL_TAG_RE, (match, tag) => {
    const normalized = normalizeLevel(tag);
    if (normalized) {
      level = normalized;
      return '';
    }
    return match;
  });
  title = title.replace(SERVICE_TAG_RE, (_, svc) => {
    services.push(svc.toLowerCase());
    return '';
  });
  const criterion = title.match(CRITERION_RE);
  if (criterion) {
    success_criteria = criterion[1].trim();
    title = title.replace(CRITERION_RE, '');
  }
  title = title.replace(BULLET_RE, '').replace(/\s{2,}/g, ' ').trim();
  return { title, level: level ?? 'unknown', services, success_criteria: success_criteria || title };
}

function splitTextObjectives(text) {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 1 && lines[0].includes(';')) {
    return lines[0]
      .split(';')
      .map((l) => l.trim())
      .filter(Boolean);
  }
  return lines;
}

function normalizeJsonObjective(entry, index) {
  if (typeof entry === 'string') return parseTextObjective(entry);
  if (!entry || typeof entry !== 'object') {
    throw new Error(`parse-goal-matrix: objective ${index + 1} must be a string or an object`);
  }
  const title = String(entry.title ?? entry.goal ?? entry.objective ?? '').trim();
  if (!title) {
    throw new Error(`parse-goal-matrix: objective ${index + 1} needs a non-empty title`);
  }
  const level = normalizeLevel(entry.level) ?? 'unknown';
  const services = Array.isArray(entry.services)
    ? entry.services.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
    : [];
  const success_criteria = String(
    entry.success_criteria ?? entry.criteria ?? entry.success ?? title,
  ).trim();
  return { title, level, services, success_criteria };
}

function attachIdsAndAmbiguities(rawObjectives) {
  return rawObjectives.map((obj, i) => {
    const ambiguities = [];
    if (obj.level === 'unknown') ambiguities.push('level');
    if (obj.services.length === 0) ambiguities.push('services');
    return { id: `G${i + 1}`, ...obj, ambiguities };
  });
}

export function parseGoalMatrix(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('parse-goal-matrix: empty input — pass the goal matrix inline (text lines or JSON)');
  }
  const { flags, rest } = extractFlags(input);
  if (!rest) {
    if (Object.keys(flags).length > 0) return { objectives: [], flags };
    throw new Error('parse-goal-matrix: empty input — pass the goal matrix inline (text lines or JSON)');
  }
  let rawObjectives;
  if (rest.startsWith('[') || rest.startsWith('{')) {
    let parsed;
    try {
      parsed = JSON.parse(rest);
    } catch {
      throw new Error('parse-goal-matrix: input looks like JSON but does not parse');
    }
    const entries = Array.isArray(parsed) ? parsed : parsed.objectives;
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error('parse-goal-matrix: JSON input must be a non-empty array (or { objectives: [...] })');
    }
    rawObjectives = entries.map(normalizeJsonObjective);
  } else {
    rawObjectives = splitTextObjectives(rest).map(parseTextObjective);
  }
  const objectives = attachIdsAndAmbiguities(rawObjectives).filter((o) => o.title);
  if (objectives.length === 0) {
    throw new Error('parse-goal-matrix: no objectives found in the input');
  }
  return { objectives, flags };
}

function main() {
  const arg = argv[2];
  if (arg === '--version') {
    stdout.write(`${VERSION}\n`);
    exit(0);
  }
  let result;
  try {
    result = parseGoalMatrix(arg ?? '');
  } catch (err) {
    stderr.write(`${err.message}\n`);
    exit(1);
  }
  if (result.objectives.length === 0) {
    stderr.write('parse-goal-matrix: no objectives found in the input\n');
    exit(1);
  }
  stdout.write(`${JSON.stringify(result)}\n`);
  exit(0);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
