#!/usr/bin/env node
// bin/probe-coverage-breadth.mjs — static coverage-BREADTH audit for the
// /jlu-goal Phase 4.5 gate.
//
// A green suite can still be production-thin: a one-happy-path test per
// requirement (a filter with `columns: []`, a single-text-column create) exits
// 0 yet never sends the production payload that 400s. This audit reads the
// touched DTO/validator surface and the authored test files and reports the
// input dimensions the suite never exercised — it does NOT run anything and it
// does NOT author tests (the workflow re-dispatches the upstream authors for
// that). The live probe that confirms a gap lives in goal.md prose.
//
// Usage:
//   node bin/probe-coverage-breadth.mjs --service <worktree> [--spec <path>] [--json]
//   node bin/probe-coverage-breadth.mjs --version
//
// Exit 0 = broad (no gap), exit 4 = thin (a gap was found), exit 1 = bad input.

import { argv, stdout, stderr, exit, cwd } from 'node:process';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '0.1.0';

const DTO_FILE_RE = /\.(dto|schema)\.[jt]sx?$/;
const TEST_FILE_RE = /\.(spec|test)\.[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next']);

// class-validator / common validation decorators that mark a field as validated.
const VALIDATOR_RE = /@(Is[A-Za-z]+|ValidateNested|Min|Max|Length|Matches|ArrayNotEmpty|ArrayMinSize)\b/g;
// signals that a test asserts a rejection (4xx / thrown validation error).
const REJECTION_RE = /\b(400|422|BadRequest|BAD_REQUEST|UnprocessableEntity|UNPROCESSABLE_ENTITY|toThrow|rejects|ValidationError)\b/;
const PROPERTY_RE = /^\s*(?:readonly\s+)?(\w+)\s*[?!]?\s*:\s*([A-Za-z0-9_<>\[\]| .]+?)\s*;?\s*$/;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Extract validated fields from one DTO file's source.
function extractValidatedFields(content) {
  const fields = [];
  let pending = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      pending = [];
      continue;
    }
    const decoratorsOnLine = [...line.matchAll(VALIDATOR_RE)].map((m) => m[1]);
    const propMatch = line.match(PROPERTY_RE);
    if (propMatch && !line.startsWith('//')) {
      const name = propMatch[1];
      const type = propMatch[2].trim();
      const decorators = [...pending, ...decoratorsOnLine];
      if (decorators.length > 0) {
        fields.push({ name, type, decorators });
      }
      pending = [];
      continue;
    }
    if (decoratorsOnLine.length > 0) {
      pending.push(...decoratorsOnLine);
      continue;
    }
    // any other meaningful line (open brace, method, etc.) breaks the decorator run
    if (!line.startsWith('@')) pending = [];
  }
  return fields;
}

function isArrayField(field) {
  return (
    field.decorators.includes('IsArray') ||
    field.decorators.includes('ArrayNotEmpty') ||
    field.decorators.includes('ArrayMinSize') ||
    /\[\]\s*$/.test(field.type) ||
    /^Array</.test(field.type)
  );
}

function isReferenceField(field) {
  return field.decorators.includes('ValidateNested') || /(^id$|Id$|Ids$|Ref$|Reference$)/.test(field.name);
}

function fileMentionsField(testContent, field) {
  return new RegExp(`\\b${escapeRegExp(field)}\\b`).test(testContent);
}

function hasRejectionForField(testFiles, field) {
  return testFiles.some((t) => fileMentionsField(t.content, field) && REJECTION_RE.test(t.content));
}

// True when the array field is assigned at least once in tests AND every
// assignment is an empty literal (never a populated array).
function isOnlyEverEmpty(testFiles, field) {
  const re = new RegExp(`${escapeRegExp(field)}\\s*:\\s*\\[([^\\]]*)\\]`, 'g');
  let sawAssignment = false;
  for (const t of testFiles) {
    for (const m of t.content.matchAll(re)) {
      sawAssignment = true;
      if (m[1].trim() !== '') return false; // a populated array exists
    }
  }
  return sawAssignment;
}

function appearsInTests(testFiles, field) {
  return testFiles.some((t) => fileMentionsField(t.content, field));
}

export function auditCoverageBreadth({ dtoFiles = [], testFiles = [] } = {}) {
  const dto_fields_without_rejection = [];
  const collections_only_empty = [];
  const cross_field_refs_unpopulated = [];

  for (const dto of dtoFiles) {
    const content = typeof dto === 'string' ? dto : dto.content;
    const source = typeof dto === 'string' ? '<inline>' : dto.name || '<inline>';
    for (const field of extractValidatedFields(content)) {
      if (!hasRejectionForField(testFiles, field.name)) {
        dto_fields_without_rejection.push(`${source}:${field.name}`);
      }
      if (isArrayField(field) && isOnlyEverEmpty(testFiles, field.name)) {
        collections_only_empty.push(`${source}:${field.name}`);
      }
      if (isReferenceField(field) && !appearsInTests(testFiles, field.name)) {
        cross_field_refs_unpopulated.push(`${source}:${field.name}`);
      }
    }
  }

  const uncovered_dimensions = [
    ...dto_fields_without_rejection.map((f) => `${f} — no rejecting-payload test (validator never exercised with a violating input)`),
    ...collections_only_empty.map((f) => `${f} — collection exercised only empty (populated path never asserted)`),
    ...cross_field_refs_unpopulated.map((f) => `${f} — cross-field reference never populated in any test`),
  ];

  const thin =
    dto_fields_without_rejection.length > 0 ||
    collections_only_empty.length > 0 ||
    cross_field_refs_unpopulated.length > 0;

  return {
    verdict: thin ? 'thin' : 'broad',
    uncovered_dimensions,
    dto_fields_without_rejection,
    collections_only_empty,
    cross_field_refs_unpopulated,
  };
}

function walk(dir, matchRe, acc) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, matchRe, acc);
    } else if (matchRe.test(entry)) {
      acc.push({ name: full, content: readFileSync(full, 'utf8') });
    }
  }
  return acc;
}

function parseArgs(args) {
  const opts = { json: false, version: false, dto: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--version') opts.version = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--service') opts.service = args[(i += 1)];
    else if (a === '--spec') opts.spec = args[(i += 1)];
    else if (a === '--dto') opts.dto.push(args[(i += 1)]);
  }
  return opts;
}

function main() {
  const opts = parseArgs(argv.slice(2));
  if (opts.version) {
    stdout.write(`${VERSION}\n`);
    exit(0);
  }
  // Scoped mode: --dto names the DTO files to audit (e.g. /jlu-ship passes
  // only the DTOs changed in THIS task, so legacy untouched DTOs are never
  // flagged). Test files are still discovered repo-wide so a rejecting test in
  // an unchanged spec still counts. Bare mode (--service only) audits the whole
  // worktree, as /jlu-goal Phase 4.5 does.
  let dtoFiles;
  let testRoot;
  if (opts.dto.length > 0) {
    for (const p of opts.dto) {
      if (!existsSync(p)) {
        stderr.write(`probe-coverage-breadth: --dto path not found: ${p}\n`);
        exit(1);
      }
    }
    dtoFiles = opts.dto.map((p) => ({ name: p, content: readFileSync(p, 'utf8') }));
    testRoot = opts.service && existsSync(opts.service) ? opts.service : cwd();
  } else {
    if (!opts.service) {
      stderr.write('probe-coverage-breadth: --service <worktree> (or one or more --dto <path>) is required\n');
      exit(1);
    }
    if (!existsSync(opts.service)) {
      stderr.write(`probe-coverage-breadth: service path not found: ${opts.service}\n`);
      exit(1);
    }
    dtoFiles = walk(opts.service, DTO_FILE_RE, []);
    testRoot = opts.service;
  }

  const testFiles = walk(testRoot, TEST_FILE_RE, []);
  const result = auditCoverageBreadth({ dtoFiles, testFiles });

  if (opts.json) {
    stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    stdout.write(`verdict: ${result.verdict}\n`);
    if (result.uncovered_dimensions.length) {
      stdout.write('uncovered dimensions:\n');
      for (const d of result.uncovered_dimensions) stdout.write(`  - ${d}\n`);
    }
  }
  exit(result.verdict === 'thin' ? 4 : 0);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
