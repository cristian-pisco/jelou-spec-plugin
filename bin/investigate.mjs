// bin/investigate.mjs
//
// Engine-neutral logic + the Fusion HTTP call for /jlu:investigate.
// Pure helpers are exported for unit testing; I/O (fetch, obs, fs) is injectable.

import { join, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { chatCompletion, OPENROUTER_BASE_URL } from './lib/openrouter.mjs';

const VALID_ENGINES = ['perplexity', 'fusion'];

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/^-|-$/g, '');
}

export function parseArgs(argv) {
  const out = { topic: null, engine: 'perplexity' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--engine') {
      out.engine = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  out.topic = positional.join(' ').trim() || null;
  if (!VALID_ENGINES.includes(out.engine)) {
    throw new Error(`unknown engine: ${out.engine} (expected ${VALID_ENGINES.join('|')})`);
  }
  return out;
}

export function renderFrontmatter({ title, slug, engines, today, status = 'open' }) {
  return [
    '---',
    `title: ${title}`,
    `slug: ${slug}`,
    `status: ${status}`,
    `engines: [${engines.join(', ')}]`,
    `created: ${today}`,
    `updated: ${today}`,
    'tags: [investigation, research]',
    'source: jlu-investigate',
    '---',
    '',
  ].join('\n');
}

export function bumpFrontmatter(fm, { engine, today }) {
  return fm.replace(/engines: \[([^\]]*)\]/, (_, list) => {
    const engines = list.split(',').map((s) => s.trim()).filter(Boolean);
    if (!engines.includes(engine)) engines.push(engine);
    return `engines: [${engines.join(', ')}]`;
  }).replace(/updated: .*/, `updated: ${today}`);
}

export function renderRound({ n, today, engine, question, answer, sources }) {
  const lines = [
    `## Round ${n} — ${today} · ${engine}`,
    '',
    `**Pregunta:** ${question}`,
    '',
    `**Respuesta:** ${answer}`,
    '',
    '**Fuentes:**',
  ];
  if (sources.length === 0) {
    lines.push('- sin fuentes — no verificado');
  } else {
    for (const s of sources) lines.push(`- ${s.title} — ${s.url}`);
  }
  lines.push('');
  return lines.join('\n');
}

const VAULT_REL = 'Resources/Investigations';

export function resolveNote({ slug, execImpl, fsImpl, cwd }) {
  const probe = execImpl('command', ['-v', 'obs']);
  const obsOk = probe.status === 0 && String(probe.stdout).trim().length > 0;

  if (obsOk) {
    const notePath = `${VAULT_REL}/${slug}.md`;
    const found = execImpl('obs', ['search', `query=${slug}`]);
    const exists = found.status === 0 && String(found.stdout).includes(slug);
    return { storage: 'obs', notePath, exists };
  }

  const notePath = join(cwd, 'investigations', `${slug}.md`);
  return { storage: 'local', notePath, exists: fsImpl.existsSync(notePath) };
}

export function extractSources(json) {
  const annotations = json?.choices?.[0]?.message?.annotations ?? [];
  return annotations
    .filter((a) => a.type === 'url_citation' && a.url_citation?.url)
    .map((a) => ({ title: a.url_citation.title || a.url_citation.url, url: a.url_citation.url }));
}

export async function runFusion({
  topic,
  apiKey,
  baseUrl = OPENROUTER_BASE_URL,
  timeoutMs = 120000,
  maxTokens = 8000,
  model = 'openrouter/fusion',
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    return { ok: false, status: 'config_error', error: 'OPENROUTER_API_KEY is not set — export it to use --engine fusion' };
  }
  const result = await chatCompletion({ model, prompt: topic, apiKey, baseUrl, timeoutMs, maxTokens, fetchImpl });
  if (!result.ok) {
    return { ok: false, status: result.timedOut ? 'timeout' : 'http_error', error: result.error };
  }
  return { ok: true, answer: result.content, sources: extractSources(result.json), raw: result.json };
}

function nextRoundNumber(body) {
  const matches = [...body.matchAll(/^## Round (\d+) /gm)];
  return matches.length ? Math.max(...matches.map((m) => Number(m[1]))) + 1 : 1;
}

export function persistRound(opts) {
  const { storage, notePath, exists, slug, title, engine, today, question, answer, sources } = opts;

  if (storage === 'local') {
    if (exists && existsSync(notePath)) {
      const body = readFileSync(notePath, 'utf8');
      const n = nextRoundNumber(body);
      const head = body.slice(0, body.indexOf('\n---', 4) + 4);
      const bumped = bumpFrontmatter(head, { engine, today });
      const rest = body.slice(head.length);
      const round = renderRound({ n, today, engine, question, answer, sources });
      writeFileSync(notePath, `${bumped}${rest}\n${round}`);
    } else {
      mkdirSync(dirname(notePath), { recursive: true });
      const fm = renderFrontmatter({ title, slug, engines: [engine], today });
      const round = renderRound({ n: 1, today, engine, question, answer, sources });
      writeFileSync(notePath, `${fm}\n${round}`);
    }
    return { storage, notePath };
  }

  // obs storage is a CLI side effect driven by the skill, not pure logic.
  throw new Error(`persistRound: unsupported storage ${storage} in pure path`);
}

function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

function spawnSyncResult(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '' };
}

async function main(argv) {
  const [sub, ...rest] = argv;
  if (sub === 'locate') {
    const { topic } = parseArgs(rest);
    const slug = slugify(topic);
    const note = resolveNote({ slug, execImpl: spawnSyncResult, fsImpl: { existsSync }, cwd: process.cwd() });
    process.stdout.write(JSON.stringify({ slug, ...note }));
    return 0;
  }
  if (sub === 'fusion') {
    const { topic } = parseArgs(rest);
    const r = await runFusion({ topic, apiKey: process.env.OPENROUTER_API_KEY });
    process.stdout.write(JSON.stringify(r));
    return r.ok ? 0 : 1;
  }
  if (sub === 'persist') {
    const payload = JSON.parse(readFileSync(flag(rest, '--payload'), 'utf8'));
    persistRound(payload);
    process.stdout.write(JSON.stringify({ ok: true, notePath: payload.notePath }));
    return 0;
  }
  process.stderr.write(`unknown subcommand: ${sub}\n`);
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
