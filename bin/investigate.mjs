// bin/investigate.mjs
//
// Engine-neutral logic + the Fusion HTTP call for /jlu:investigate.
// Pure helpers are exported for unit testing; I/O (fetch, obs, fs) is injectable.

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
