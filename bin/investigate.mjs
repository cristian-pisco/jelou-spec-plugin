// bin/investigate.mjs
//
// Engine-neutral logic + the Fusion HTTP call for /jlu:investigate.
// Pure helpers are exported for unit testing; I/O (fetch, obs, fs) is injectable.

import { join } from 'node:path';
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
