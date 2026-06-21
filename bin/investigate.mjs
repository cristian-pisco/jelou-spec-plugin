// bin/investigate.mjs
//
// Engine-neutral logic + the Fusion HTTP call for /jlu:investigate.
// Pure helpers are exported for unit testing; I/O (fetch, obs, fs) is injectable.

import { join, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
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
  }).replace(/^updated: .*/m, `updated: ${today}`);
}

export function renderRound({ n, today, engine, question, answer, sources }) {
  const lines = [
    `## Round ${n} — ${today} · ${engine}`,
    '',
    `**Question:** ${question}`,
    '',
    `**Answer:** ${answer}`,
    '',
    '**Sources:**',
  ];
  if (sources.length === 0) {
    lines.push('- no sources — unverified');
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
    const listed = execImpl('obs', ['files', `folder=${VAULT_REL}`]);
    const target = `${slug}.md`;
    const exists =
      listed.status === 0 &&
      String(listed.stdout)
        .split(/\r?\n/)
        .some((line) => line.trim().split('/').pop() === target);
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

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/;

function nextRoundNumber(body) {
  const matches = [...body.matchAll(/^## Round (\d+) — .+ · /gm)];
  return matches.length ? Math.max(...matches.map((m) => Number(m[1]))) + 1 : 1;
}

export function buildNoteContent({ existingContent, exists, slug, title, engine, today, question, answer, sources }) {
  if (exists && existingContent) {
    const match = existingContent.match(FRONTMATTER_RE);
    if (match) {
      const head = match[0];
      const rest = existingContent.slice(head.length);
      const round = renderRound({ n: nextRoundNumber(rest), today, engine, question, answer, sources });
      return `${bumpFrontmatter(head, { engine, today })}${rest}\n${round}`;
    }
    // Recovery: a note that lost its frontmatter gets a fresh header; engines/created reset by design.
    const fm = renderFrontmatter({ title, slug, engines: [engine], today });
    return `${fm}${existingContent}\n${renderRound({ n: nextRoundNumber(existingContent), today, engine, question, answer, sources })}`;
  }
  const fm = renderFrontmatter({ title, slug, engines: [engine], today });
  return `${fm}\n${renderRound({ n: 1, today, engine, question, answer, sources })}`;
}

function currentEngines(head) {
  const m = head.match(/engines: \[([^\]]*)\]/);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

export function renderParts(opts) {
  const { existingContent, exists, engine, today, question, answer, sources } = opts;
  const fullNote = buildNoteContent(opts);
  let n = 1;
  let engines = [engine];
  if (exists && existingContent) {
    const match = existingContent.match(FRONTMATTER_RE);
    const head = match ? match[0] : '';
    const rest = match ? existingContent.slice(head.length) : existingContent;
    n = nextRoundNumber(rest);
    const existing = currentEngines(head);
    engines = existing.includes(engine) ? existing : [...existing, engine];
  }
  const roundBlock = renderRound({ n, today, engine, question, answer, sources });
  return { fullNote, roundBlock, engines, updated: today };
}

export function persistRound(opts) {
  const { storage, notePath, exists } = opts;
  if (storage !== 'local') {
    // obs storage is a CLI side effect driven by the skill via the render subcommand.
    throw new Error(`persistRound: unsupported storage ${storage} in pure path`);
  }
  const existingContent = exists && existsSync(notePath) ? readFileSync(notePath, 'utf8') : '';
  if (!existingContent) mkdirSync(dirname(notePath), { recursive: true });
  const content = buildNoteContent({ ...opts, existingContent, exists: Boolean(existingContent) });
  writeFileSync(notePath, content);
  return { storage: 'local', notePath };
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
  if (sub === 'render') {
    const payload = JSON.parse(readFileSync(flag(rest, '--payload'), 'utf8'));
    process.stdout.write(JSON.stringify(renderParts(payload)));
    return 0;
  }
  process.stderr.write(`unknown subcommand: ${sub}\n`);
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
