#!/usr/bin/env node
import { argv, stdout, stderr, exit } from 'node:process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.0';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const LIST_KEYS = new Set(['services', 'depends-on', 'service-order', 'covers']);
const ACCEPTANCE_LABEL_RE = /^\s*-\s*\[(success|rejection|realistic|boundary)\b/;

function parseFlowList(value) {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseFrontmatter(fmText) {
  const frontmatter = {};
  for (const line of fmText.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    const value = line.slice(idx + 1).trim();
    if (LIST_KEYS.has(key)) {
      frontmatter[key] = value.startsWith('[') && value.endsWith(']') ? parseFlowList(value) : [];
    } else {
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

export function parseStory(raw) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: null, acceptanceLabels: [], body: raw };
  }
  const [, fmText, body] = match;
  const acceptanceLabels = [];
  for (const line of body.split('\n')) {
    const m = line.match(ACCEPTANCE_LABEL_RE);
    if (m) acceptanceLabels.push(m[1]);
  }
  return { frontmatter: parseFrontmatter(fmText), acceptanceLabels, body };
}

export function validateStory(raw, opts = {}) {
  const { knownServices, name } = opts;
  const { frontmatter, acceptanceLabels } = parseStory(raw);
  if (!frontmatter) {
    return { id: null, errors: [`story '${name || '<unknown>'}': missing or malformed frontmatter`] };
  }
  const id = typeof frontmatter.id === 'string' ? frontmatter.id : null;
  const label = id || name || '<unknown>';
  const errors = [];

  if (!id) errors.push(`story '${label}': missing required frontmatter field 'id'`);

  const services = frontmatter.services;
  if (!Array.isArray(services) || services.length === 0) {
    errors.push(`story '${label}': missing required frontmatter field 'services' (need >=1)`);
  } else if (Array.isArray(knownServices) && knownServices.length > 0) {
    for (const svc of services) {
      if (!knownServices.includes(svc)) {
        errors.push(`story '${label}': service '${svc}' is not declared in services.yaml`);
      }
    }
  }

  const covers = frontmatter.covers;
  if (!Array.isArray(covers) || covers.length === 0) {
    errors.push(`story '${label}': missing required frontmatter field 'covers' (need >=1 FR id)`);
  }

  if (!acceptanceLabels.includes('success')) {
    errors.push(`story '${label}': acceptance criteria need at least one [success] bullet`);
  }

  return { id, errors };
}

export function coverageLint(frIds, stories) {
  const frSet = new Set(frIds);
  const covered = new Set();
  const orphanStories = [];
  const unknownFrRefs = new Set();

  for (const s of stories) {
    const covers = Array.isArray(s.covers) ? s.covers : [];
    const real = covers.filter((fr) => frSet.has(fr));
    for (const fr of real) covered.add(fr);
    for (const fr of covers) {
      if (!frSet.has(fr)) unknownFrRefs.add(fr);
    }
    if (real.length === 0) orphanStories.push(s.id);
  }

  const missingFrs = frIds.filter((fr) => !covered.has(fr));
  const ok = missingFrs.length === 0 && orphanStories.length === 0 && unknownFrRefs.size === 0;
  return { ok, missingFrs, orphanStories, unknownFrRefs: [...unknownFrRefs] };
}

export function parseServiceIds(raw) {
  const ids = [];
  const re = /^\s*-\s*id:\s*(\S+)\s*$/gm;
  let m;
  while ((m = re.exec(raw)) !== null) ids.push(m[1]);
  return ids;
}

export function parseSpecFrIds(raw) {
  const ids = [];
  const seen = new Set();
  const re = /^\s*-\s*\*{0,2}(FR-\d+)\*{0,2}\s*:/gm;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }
  return ids;
}

function parseArgs(args) {
  const opts = { dir: null, services: null, spec: null };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--services') opts.services = args[++i];
    else if (a === '--spec') opts.spec = args[++i];
    else if (!opts.dir) opts.dir = a;
  }
  return opts;
}

function collectStoryFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.story.md'))
    .sort()
    .map((f) => join(dir, f));
}

function main() {
  const first = argv[2];
  if (first === '--version') {
    stdout.write(`${VERSION}\n`);
    exit(0);
  }

  const opts = parseArgs(argv.slice(2));
  if (!opts.dir) {
    stderr.write('validate-stories: a stories directory argument is required\n');
    exit(1);
  }

  if (!existsSync(opts.dir) || !statSync(opts.dir).isDirectory()) {
    stdout.write(`${JSON.stringify({ ok: true, storiesPresent: false, stories: [] })}\n`);
    exit(0);
  }

  const knownServices = opts.services ? parseServiceIds(readFileSync(opts.services, 'utf8')) : null;
  const files = collectStoryFiles(opts.dir);

  const results = [];
  const parsedStories = [];
  const messages = [];

  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const name = file.split('/').pop();
    const r = validateStory(raw, { knownServices, name });
    results.push({ file: name, id: r.id, errors: r.errors });
    messages.push(...r.errors);
    const { frontmatter } = parseStory(raw);
    if (frontmatter) {
      parsedStories.push({ id: frontmatter.id || name, covers: frontmatter.covers || [] });
    }
  }

  let coverage = null;
  if (opts.spec) {
    const frIds = parseSpecFrIds(readFileSync(opts.spec, 'utf8'));
    coverage = coverageLint(frIds, parsedStories);
    for (const fr of coverage.missingFrs) {
      messages.push(`coverage: ${fr} is not covered by any story`);
    }
    for (const id of coverage.orphanStories) {
      messages.push(`coverage: story '${id}' covers no requirement defined in SPEC.md`);
    }
    for (const fr of coverage.unknownFrRefs) {
      messages.push(`coverage: a story references '${fr}' which is not defined in SPEC.md`);
    }
  }

  const storyErrors = results.some((r) => r.errors.length > 0);
  const coverageFail = coverage ? !coverage.ok : false;
  const ok = !storyErrors && !coverageFail;

  stdout.write(`${JSON.stringify({ ok, storiesPresent: true, stories: results, coverage })}\n`);
  if (!ok) {
    for (const msg of messages) stderr.write(`${msg}\n`);
    exit(1);
  }
  exit(0);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
