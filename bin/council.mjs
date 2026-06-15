#!/usr/bin/env node
// bin/council.mjs
//
// Fan-out engine for /jlu:council (design doc Revisión 5).
// Pure judge dispatch: OpenRouter API judges (single-shot, expediente-only)
// plus optional agentic CLI extras (codex, gemini). The workflow orchestrates
// and arbitrates; this script only collects envelopes.
//
// Usage:
//   node bin/council.mjs "<idea text | path-to-idea-file>" \
//     [--context <path>]... [--services id1,id2]
//
// Stdout: single JSON document { run_dir, inventory, envelopes }.
// Stderr: human messages + 30s heartbeat while CLI judges run.
// Exit 0 when at least one judge returned ok; non-zero otherwise.

import { spawn, execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  statSync,
  accessSync,
  constants as fsConstants,
} from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chatCompletion } from './lib/openrouter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRIEF_REL = 'jelou/references/council-brief.md';

// Default roster: four distinct frontier reasoning lineages (Premise 2),
// validated live against the OpenRouter catalog — each returns a schema-valid
// verdict. qwen3.7-max was rejected: it ignores strict json_schema and drops
// required fields, so its verdicts parse as malformed. Model ids drift — verify
// against https://openrouter.ai/models before a run or pin your own in
// council.config.json.
export const DEFAULTS = {
  models: [
    'openai/gpt-5.5',
    'google/gemini-3.1-pro-preview',
    'deepseek/deepseek-v4-pro',
    'anthropic/claude-opus-4.8',
  ],
  // Reasoning tokens count against max_tokens; 2000 truncated verbose verdicts
  // mid-JSON (→ malformed). 8000 leaves headroom for thinking + the full verdict.
  max_tokens: 8000,
  timeout_ms: 90_000,
  cli_timeout_ms: 180_000,
  data_collection: 'deny',
  case_file_max_bytes: 102_400,
  runs_dir: null,
};

const VERDICT_TOKENS = ['GO', 'GO_WITH_CONDITIONS', 'NO_GO'];

// `uncertainties` is the hinge of the deliberation loop: judges have no live
// web access, so instead of assuming a fact they cannot verify they declare it
// here. The arbiter researches each one between rounds and folds the answer
// back into the case file. Required (empty array when none) so strict-schema
// judges always emit the field.
export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'refutations', 'tradeoffs', 'conditions', 'evidence_from_repo', 'uncertainties'],
  properties: {
    verdict: { type: 'string', enum: VERDICT_TOKENS },
    refutations: { type: 'array', items: { type: 'string' } },
    tradeoffs: { type: 'array', items: { type: 'string' } },
    conditions: { type: 'array', items: { type: 'string' } },
    evidence_from_repo: { type: 'array', items: { type: 'string' } },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
};

const MAP_CODEBASE_DOCS = [
  'ARCHITECTURE.md',
  'CONVENTIONS.md',
  'CONCERNS.md',
  'STACK.md',
  'STRUCTURE.md',
  'INTEGRATIONS.md',
];

const AGENTIC_PREAMBLE =
  'IMPORTANT: do not invoke or delegate to any skills, tools, agents, or councils. ' +
  'Provide your own analysis only. You may read files in this repository to gather ' +
  'evidence, but you must not modify anything.';

const API_PREAMBLE = 'You have no repository access. Judge strictly on the case file above.';

export function generateSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/^-|-$/g, '');
}

export function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function sameFamilyAsArbiter(modelId) {
  return /anthropic|claude/i.test(modelId);
}

export function loadConfig({ cwd, workspaceRoot }) {
  const candidates = [cwd, workspaceRoot]
    .filter(Boolean)
    .map((dir) => join(dir, 'council.config.json'));
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      throw new Error(`invalid JSON in ${path}: ${err.message}`);
    }
    return { ...DEFAULTS, ...parsed };
  }
  return { ...DEFAULTS };
}

export function findWorkspaceRoot(startDir, maxUp = 5) {
  let dir = resolve(startDir);
  for (let i = 0; i <= maxUp; i++) {
    if (existsSync(join(dir, '.spec-workspace.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function buildCaseFile({ ideaText, contextPaths = [], services = [], workspaceRoot }) {
  const included = [];
  const absent = [];
  const sections = [];

  const addFile = (name, path) => {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8');
      included.push({ name, path, bytes: statSync(path).size });
      sections.push(`## ${name}\n\n${content}`);
    } else {
      absent.push({ name, reason: 'missing-file' });
    }
  };

  if (!workspaceRoot) {
    absent.push({ name: 'jlu-artifacts', reason: 'no-workspace' });
  } else if (services.length === 0) {
    absent.push({ name: 'jlu-artifacts', reason: 'no-services-selected' });
  } else {
    for (const service of services) {
      for (const doc of MAP_CODEBASE_DOCS) {
        addFile(`${service}/${doc}`, join(workspaceRoot, 'services', service, 'codebase', doc));
      }
    }
  }

  for (const ctx of contextPaths) {
    addFile(basename(ctx), ctx);
  }

  const text = sections.join('\n\n');
  return { text, inventory: { included, absent } };
}

export function preflight(caseFileText, maxBytes) {
  const bytes = Buffer.byteLength(caseFileText, 'utf8');
  if (bytes > maxBytes) {
    throw new Error(
      `case file is ${bytes} bytes, over the ${maxBytes} limit (case_file_max_bytes). ` +
        'Deselect services, trim --context files, or raise the limit in council.config.json. ' +
        'No judge was called.',
    );
  }
  return bytes;
}

export function composeBrief({ template, idea, expediente, agentic }) {
  const modo = agentic ? AGENTIC_PREAMBLE : API_PREAMBLE;
  return template
    .replaceAll('{IDEA}', idea)
    .replaceAll('{EXPEDIENTE}', expediente || '(empty case file)')
    .replaceAll('{MODO_AGENTICO}', modo);
}

export function parseJudgeJson(text) {
  if (!text || !text.trim()) return { ok: false, reason: 'empty' };

  const attempts = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) attempts.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) attempts.push(text.slice(first, last + 1));

  for (const candidate of attempts) {
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj === 'object' && VERDICT_TOKENS.includes(obj.verdict)) {
        return { ok: true, verdict: obj };
      }
    } catch {
      // try the next extraction strategy
    }
  }
  return { ok: false, reason: 'malformed' };
}

export function buildCliCommand(kind, prompt, { isGitRepo }) {
  if (kind === 'codex') {
    const args = ['exec', prompt, '-s', 'read-only'];
    if (!isGitRepo) args.push('--skip-git-repo-check');
    return { cmd: 'codex', args };
  }
  if (kind === 'gemini') {
    return { cmd: 'gemini', args: ['-p', prompt] };
  }
  throw new Error(`unknown CLI judge: ${kind}`);
}

export function killWithEscalation(proc, graceMs = 5000) {
  proc.kill('SIGTERM');
  const timer = setTimeout(() => {
    try {
      proc.kill('SIGKILL');
    } catch {
      // process already gone
    }
  }, graceMs);
  if (typeof timer.unref === 'function') timer.unref();
  proc.once('exit', () => clearTimeout(timer));
}

export function resolveRunsDir({ config, workspaceRoot, cwd }) {
  if (config.runs_dir) return config.runs_dir;
  if (workspaceRoot) return join(workspaceRoot, '.spec-workspace', 'council');
  return join(cwd, 'council-runs');
}

export function makeRunDir(baseDir, slug) {
  let dir = join(baseDir, slug);
  if (existsSync(dir)) dir = `${dir}-${Date.now()}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

// A consensus session spans several rounds; --session-dir pins them all under
// one folder (round-1, round-2, …) so the transcript reads in order and the
// arbiter can re-inject prior rounds as context. Without --session-dir the
// engine keeps its single-shot per-invocation slug dir (backward compatible).
export function resolveRoundDir({ sessionDir, round = 1 }) {
  return join(sessionDir, `round-${round}`);
}

function defaultWhich(bin) {
  return (process.env.PATH || '').split(':').some((dir) => {
    try {
      accessSync(join(dir, bin), fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function detectJudges({ env = process.env, whichImpl = defaultWhich } = {}) {
  return {
    api: Boolean(env.OPENROUTER_API_KEY),
    clis: ['codex', 'gemini'].filter((bin) => whichImpl(bin)),
  };
}

function envelopeBase(judge, transport, startedAt) {
  return {
    judge,
    transport,
    status: 'ok',
    verdict: null,
    error: null,
    elapsed_ms: Date.now() - startedAt,
    word_count: 0,
    same_family_as_arbiter: sameFamilyAsArbiter(judge),
    label: transport === 'openrouter' ? 'expediente-only' : 'agéntico',
  };
}

async function judgeViaOpenRouter(model, opts, withSchema = true) {
  const { prompt, apiKey, baseUrl, timeoutMs, maxTokens, dataCollection, fetchImpl } = opts;
  const startedAt = Date.now();
  const responseFormat = withSchema
    ? { type: 'json_schema', json_schema: { name: 'council_verdict', strict: true, schema: VERDICT_SCHEMA } }
    : null;

  const result = await chatCompletion({
    model, prompt, apiKey, baseUrl, timeoutMs, maxTokens, dataCollection, responseFormat, fetchImpl,
  });

  // A 400 with a strict json_schema means the model ignores it; retry as free text.
  if (!result.ok && result.httpStatus === 400 && withSchema) {
    return judgeViaOpenRouter(model, opts, false);
  }

  const envelope = envelopeBase(model, 'openrouter', startedAt);
  if (!result.ok) {
    envelope.status = result.timedOut ? 'timeout' : 'http_error';
    envelope.error = result.error;
    envelope.elapsed_ms = Date.now() - startedAt;
    return envelope;
  }

  const content = result.content;
  envelope.word_count = wordCount(content);
  envelope.raw = content;
  const parsed = parseJudgeJson(content);
  if (parsed.ok) {
    envelope.verdict = parsed.verdict;
  } else {
    envelope.status = parsed.reason;
    envelope.error = `judge output is ${parsed.reason}`;
  }
  envelope.elapsed_ms = Date.now() - startedAt;
  return envelope;
}

export async function fanOutApi({
  models,
  prompt,
  apiKey,
  baseUrl = 'https://openrouter.ai/api',
  timeoutMs = DEFAULTS.timeout_ms,
  maxTokens = DEFAULTS.max_tokens,
  dataCollection = DEFAULTS.data_collection,
  fetchImpl = fetch,
}) {
  const opts = { prompt, apiKey, baseUrl, timeoutMs, maxTokens, dataCollection, fetchImpl };
  const settled = await Promise.allSettled(models.map((m) => judgeViaOpenRouter(m, opts)));
  return settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    const envelope = envelopeBase(models[i], 'openrouter', Date.now());
    envelope.status = 'http_error';
    envelope.error = String(result.reason?.message || result.reason);
    return envelope;
  });
}

function isGitRepo(cwd) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe', cwd });
    return true;
  } catch {
    return false;
  }
}

function runCliJudge(kind, prompt, { cwd, timeoutMs }) {
  const startedAt = Date.now();
  const { cmd, args } = buildCliCommand(kind, prompt, { isGitRepo: isGitRepo(cwd) });

  return new Promise((resolvePromise) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killWithEscalation(proc, 5000);
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const envelope = envelopeBase(kind, 'cli', startedAt);
      envelope.raw = stdout;
      envelope.stderr = stderr;
      envelope.word_count = wordCount(stdout);
      if (timedOut) {
        envelope.status = 'timeout';
        envelope.error = `killed after ${timeoutMs}ms`;
      } else if (code !== 0) {
        envelope.status = 'http_error';
        envelope.error = `exit ${code}: ${stderr.slice(0, 300)}`;
      } else {
        const parsed = parseJudgeJson(stdout);
        if (parsed.ok) envelope.verdict = parsed.verdict;
        else {
          envelope.status = parsed.reason;
          envelope.error = `judge output is ${parsed.reason}`;
        }
      }
      envelope.elapsed_ms = Date.now() - startedAt;
      resolvePromise(envelope);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      const envelope = envelopeBase(kind, 'cli', startedAt);
      envelope.status = 'http_error';
      envelope.error = String(err.message || err);
      envelope.elapsed_ms = Date.now() - startedAt;
      resolvePromise(envelope);
    });
  });
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  let idea = '';
  const contextPaths = [];
  let services = [];
  let sessionDir = null;
  let round = 1;

  // A flag's value must exist and must not be another flag. Without this a
  // trailing `--context` (or `--context --services`) silently swallows a flag
  // or pushes `undefined`, which only blows up later in buildCaseFile — and a
  // valueless `--session-dir` would silently downgrade the run to single-shot.
  const takeValue = (i, flag) => {
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`option ${flag} requires a value`);
    }
    return value;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--context') {
      contextPaths.push(takeValue(i, '--context'));
      i++;
    } else if (arg === '--services') {
      services = takeValue(i, '--services').split(',').map((s) => s.trim()).filter(Boolean);
      i++;
    } else if (arg === '--session-dir') {
      sessionDir = takeValue(i, '--session-dir');
      i++;
    } else if (arg === '--round') {
      round = Number.parseInt(takeValue(i, '--round'), 10);
      if (!Number.isInteger(round) || round < 1) {
        throw new Error('--round must be a positive integer');
      }
      i++;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (!idea) {
      idea = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  if (!idea || !idea.trim()) {
    throw new Error('idea is required: pass the idea text or a path to a file containing it');
  }
  if (idea.length < 512 && /\.(md|txt)$/i.test(idea) && !existsSync(idea)) {
    throw new Error(`idea file not found: ${idea}`);
  }
  if (existsSync(idea) && statSync(idea).isFile()) {
    idea = readFileSync(idea, 'utf8');
  }
  return { idea, contextPaths, services, sessionDir, round };
}

async function main() {
  const cwd = process.cwd();
  let exitCode = 0;
  try {
    const { idea, contextPaths, services, sessionDir, round } = parseArgs(process.argv);
    const workspaceRoot = findWorkspaceRoot(cwd);
    const config = loadConfig({ cwd, workspaceRoot });

    const { text: expediente, inventory } = buildCaseFile({
      ideaText: idea,
      contextPaths,
      services,
      workspaceRoot,
    });
    preflight(expediente, config.case_file_max_bytes);

    const judges = detectJudges({});
    if (!judges.api && judges.clis.length === 0) {
      throw new Error(
        'no judges available: export OPENROUTER_API_KEY for the API roster, ' +
          'or install/authenticate codex or gemini for CLI judges.',
      );
    }

    const template = readFileSync(join(ROOT, BRIEF_REL), 'utf8');
    const apiBrief = composeBrief({ template, idea, expediente, agentic: false });
    const cliBrief = composeBrief({ template, idea, expediente, agentic: true });

    let runsBase;
    let runDir;
    if (sessionDir) {
      runsBase = sessionDir;
      runDir = resolveRoundDir({ sessionDir, round });
      mkdirSync(runDir, { recursive: true });
    } else {
      runsBase = resolveRunsDir({ config, workspaceRoot, cwd });
      mkdirSync(runsBase, { recursive: true });
      runDir = makeRunDir(runsBase, generateSlug(idea) || 'council-run');
    }
    writeFileSync(join(runDir, 'prompt.md'), apiBrief);

    const work = [];
    if (judges.api) {
      work.push(
        fanOutApi({
          models: config.models,
          prompt: apiBrief,
          apiKey: process.env.OPENROUTER_API_KEY,
          timeoutMs: config.timeout_ms,
          maxTokens: config.max_tokens,
          dataCollection: config.data_collection,
        }),
      );
    }
    for (const cli of judges.clis) {
      work.push(runCliJudge(cli, cliBrief, { cwd, timeoutMs: config.cli_timeout_ms }).then((e) => [e]));
    }

    let heartbeat = null;
    if (judges.clis.length > 0) {
      const startedAt = Date.now();
      heartbeat = setInterval(() => {
        const s = Math.round((Date.now() - startedAt) / 1000);
        process.stderr.write(`[${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}] council running (CLI judges active)\n`);
      }, 30_000);
      heartbeat.unref();
    }

    const settled = await Promise.allSettled(work);
    if (heartbeat) clearInterval(heartbeat);
    const envelopes = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

    for (const envelope of envelopes) {
      const safe = envelope.judge.replace(/[^a-z0-9.-]/gi, '_');
      writeFileSync(join(runDir, `${safe}.md`), envelope.raw ?? '');
      if (envelope.stderr) writeFileSync(join(runDir, `${safe}.stderr`), envelope.stderr);
      delete envelope.raw;
      delete envelope.stderr;
    }

    const manifest = {
      slug: basename(sessionDir || runDir),
      round,
      timestamp: new Date().toISOString(),
      config: { ...config, runs_dir: runsBase },
      inventory,
      envelopes,
    };
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

    const okCount = envelopes.filter((e) => e.status === 'ok').length;
    process.stderr.write(`council: round ${round} — ${okCount}/${envelopes.length} judges ok → ${runDir}\n`);
    process.stdout.write(JSON.stringify({ run_dir: runDir, round, inventory, envelopes }) + '\n');

    if (okCount === 0) {
      process.stderr.write('council: zero judges returned ok — nothing to arbitrate.\n');
      exitCode = 1;
    }
  } catch (err) {
    process.stderr.write(`council error: ${err.message}\n`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
