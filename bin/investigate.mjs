// bin/investigate.mjs
//
// Engine-neutral logic + the Fusion HTTP call for /jlu:investigate.
// Pure helpers are exported for unit testing; I/O (fetch, obs, fs) is injectable.

import { join } from 'node:path';

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
