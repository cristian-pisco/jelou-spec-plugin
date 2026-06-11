// tests/unit/council.test.mjs
//
// Run: `node --test tests/unit/council.test.mjs`
//
// Unit + E2E-lite coverage for bin/council.mjs (design doc Revisión 5).
// The fan-out is tested against a local http.createServer mock of the
// OpenRouter endpoint — zero external dependencies, zero real spend.

import { test, describe, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';

import {
  DEFAULTS,
  VERDICT_SCHEMA,
  generateSlug,
  wordCount,
  sameFamilyAsArbiter,
  loadConfig,
  findWorkspaceRoot,
  buildCaseFile,
  preflight,
  composeBrief,
  parseJudgeJson,
  buildCliCommand,
  killWithEscalation,
  resolveRunsDir,
  makeRunDir,
  resolveRoundDir,
  detectJudges,
  fanOutApi,
  parseArgs,
} from '../../bin/council.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'council-test-'));

describe('generateSlug', () => {
  test('lowercases, hyphenates and caps length', () => {
    const slug = generateSlug('Migrar el Router a gRPC?? Sí: ahora ' + 'x'.repeat(100));
    assert.match(slug, /^[a-z0-9-]+$/);
    assert.ok(slug.length <= 40);
    assert.ok(!slug.startsWith('-') && !slug.endsWith('-'));
  });
});

describe('wordCount / sameFamilyAsArbiter', () => {
  test('counts words and flags claude lineage', () => {
    assert.equal(wordCount('  one  two\nthree '), 3);
    assert.equal(wordCount(''), 0);
    assert.equal(sameFamilyAsArbiter('anthropic/claude-sonnet-4.5'), true);
    assert.equal(sameFamilyAsArbiter('openai/gpt-5.1'), false);
  });
});

describe('loadConfig', () => {
  test('returns defaults when no config file exists', () => {
    const cwd = tmp();
    const cfg = loadConfig({ cwd, workspaceRoot: null });
    assert.equal(cfg.models.length, 4);
    assert.equal(cfg.case_file_max_bytes, DEFAULTS.case_file_max_bytes);
  });

  test('cwd config wins over workspace config, partial merge with defaults', () => {
    const cwd = tmp();
    const ws = tmp();
    writeFileSync(join(ws, 'council.config.json'), JSON.stringify({ max_tokens: 1111 }));
    writeFileSync(join(cwd, 'council.config.json'), JSON.stringify({ max_tokens: 2222 }));
    const cfg = loadConfig({ cwd, workspaceRoot: ws });
    assert.equal(cfg.max_tokens, 2222);
    assert.equal(cfg.models.length, 4, 'unset keys come from defaults');
  });

  test('invalid JSON fails loud with the offending path, never silent', () => {
    const cwd = tmp();
    writeFileSync(join(cwd, 'council.config.json'), '{ nope ');
    assert.throws(() => loadConfig({ cwd, workspaceRoot: null }), (err) => {
      assert.match(err.message, /council\.config\.json/);
      assert.match(err.message, /invalid JSON/i);
      return true;
    });
  });
});

describe('DEFAULTS roster invariants', () => {
  test('four provider/model ids, all distinct lineages', () => {
    assert.equal(DEFAULTS.models.length, 4);
    for (const id of DEFAULTS.models) assert.match(id, /^[a-z0-9-]+\/[a-z0-9.\-:]+$/i);
    const providers = DEFAULTS.models.map((id) => id.split('/')[0]);
    assert.equal(new Set(providers).size, 4, 'heterogeneous lineages: no provider repeats');
  });

  test('exactly one judge shares the arbiter family (Anthropic)', () => {
    assert.equal(DEFAULTS.models.filter(sameFamilyAsArbiter).length, 1);
  });

  test('does not regress to known-broken ids', () => {
    assert.ok(!DEFAULTS.models.includes('google/gemini-3-pro-preview'), '404 on OpenRouter');
    assert.ok(!DEFAULTS.models.includes('qwen/qwen3-coder'), 'not a reasoning model');
  });

  test('max_tokens leaves headroom for reasoning + verdict', () => {
    assert.ok(DEFAULTS.max_tokens >= 4000, '2000 truncated verbose verdicts mid-JSON');
  });
});

describe('findWorkspaceRoot', () => {
  test('finds .spec-workspace.json up to 5 parents, else null', () => {
    const root = tmp();
    writeFileSync(join(root, '.spec-workspace.json'), '{}');
    const deep = join(root, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    assert.equal(findWorkspaceRoot(deep), root);

    const lonely = tmp();
    assert.equal(findWorkspaceRoot(lonely), null);
  });
});

describe('buildCaseFile', () => {
  test('no workspace → empty inventory with no-workspace reason', () => {
    const { inventory } = buildCaseFile({
      ideaText: 'idea',
      contextPaths: [],
      services: [],
      workspaceRoot: null,
    });
    assert.equal(inventory.included.length, 0);
    assert.ok(inventory.absent.some((a) => a.reason === 'no-workspace'));
  });

  test('includes existing service artifacts with bytes, missing files listed with reason', () => {
    const ws = tmp();
    const codebase = join(ws, 'services', 'svc-a', 'codebase');
    mkdirSync(codebase, { recursive: true });
    writeFileSync(join(codebase, 'ARCHITECTURE.md'), '# arch\ncontent');
    const { text, inventory } = buildCaseFile({
      ideaText: 'idea',
      contextPaths: [],
      services: ['svc-a'],
      workspaceRoot: ws,
    });
    const arch = inventory.included.find((i) => i.name.includes('ARCHITECTURE'));
    assert.ok(arch, 'ARCHITECTURE.md included');
    assert.ok(arch.bytes > 0);
    assert.match(text, /# arch/);
    assert.ok(inventory.absent.some((a) => a.reason === 'missing-file'));
  });

  test('context paths are included; nonexistent context is absent with reason', () => {
    const dir = tmp();
    const spec = join(dir, 'SPEC.md');
    writeFileSync(spec, 'spec body');
    const { inventory } = buildCaseFile({
      ideaText: 'idea',
      contextPaths: [spec, join(dir, 'nope.md')],
      services: [],
      workspaceRoot: null,
    });
    assert.ok(inventory.included.some((i) => i.path === spec));
    assert.ok(inventory.absent.some((a) => a.reason === 'missing-file' && a.name.includes('nope')));
  });
});

describe('preflight', () => {
  test('over budget throws actionable message before any fetch', () => {
    assert.throws(() => preflight('x'.repeat(200), 100), (err) => {
      assert.match(err.message, /200/);
      assert.match(err.message, /case_file_max_bytes|límite/i);
      return true;
    });
    preflight('small', 100);
  });
});

describe('composeBrief', () => {
  const template = 'A {IDEA} B {EXPEDIENTE} C {MODO_AGENTICO} D';
  test('replaces placeholders for expediente-only judges', () => {
    const out = composeBrief({ template, idea: 'I', expediente: 'E', agentic: false });
    assert.match(out, /A I B E C /);
    assert.match(out, /no repository access/i);
  });
  test('agentic mode carries the anti-delegation preamble', () => {
    const out = composeBrief({ template, idea: 'I', expediente: 'E', agentic: true });
    assert.match(out, /do not invoke or delegate/i);
    assert.match(out, /must not modify/i);
  });
});

describe('parseJudgeJson', () => {
  const good = { verdict: 'NO_GO', refutations: ['r'], tradeoffs: [], conditions: [], evidence_from_repo: [], uncertainties: [] };

  test('parses raw JSON', () => {
    const res = parseJudgeJson(JSON.stringify(good));
    assert.equal(res.ok, true);
    assert.equal(res.verdict.verdict, 'NO_GO');
  });

  test('parses fenced and prose-wrapped JSON', () => {
    const fenced = '```json\n' + JSON.stringify(good) + '\n```';
    assert.equal(parseJudgeJson(fenced).ok, true);
    const prose = 'Sure! Here is my verdict:\n' + JSON.stringify(good) + '\nHope it helps.';
    assert.equal(parseJudgeJson(prose).ok, true);
  });

  test('invalid token, broken JSON and empty are classified', () => {
    assert.equal(parseJudgeJson(JSON.stringify({ ...good, verdict: 'MAYBE' })).reason, 'malformed');
    assert.equal(parseJudgeJson('{ broken').reason, 'malformed');
    assert.equal(parseJudgeJson('   \n ').reason, 'empty');
  });
});

describe('buildCliCommand', () => {
  test('codex gets read-only sandbox and skip-git-repo-check only outside repos', () => {
    const inRepo = buildCliCommand('codex', 'PROMPT', { isGitRepo: true });
    assert.equal(inRepo.cmd, 'codex');
    assert.ok(inRepo.args.includes('exec'));
    assert.ok(inRepo.args.includes('read-only'));
    assert.ok(!inRepo.args.includes('--skip-git-repo-check'));

    const outRepo = buildCliCommand('codex', 'PROMPT', { isGitRepo: false });
    assert.ok(outRepo.args.includes('--skip-git-repo-check'));
  });

  test('gemini runs headless with -p', () => {
    const g = buildCliCommand('gemini', 'PROMPT', { isGitRepo: true });
    assert.equal(g.cmd, 'gemini');
    assert.ok(g.args.includes('-p'));
  });
});

describe('killWithEscalation', () => {
  test('SIGTERM first, SIGKILL after grace when the process ignores it', async () => {
    const proc = new EventEmitter();
    proc.signals = [];
    proc.kill = (sig) => proc.signals.push(sig);
    killWithEscalation(proc, 10);
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(proc.signals, ['SIGTERM', 'SIGKILL']);
  });

  test('no SIGKILL when the process exits within grace', async () => {
    const proc = new EventEmitter();
    proc.signals = [];
    proc.kill = (sig) => proc.signals.push(sig);
    killWithEscalation(proc, 50);
    proc.emit('exit');
    await new Promise((r) => setTimeout(r, 70));
    assert.deepEqual(proc.signals, ['SIGTERM']);
  });
});

describe('parseArgs flag validation', () => {
  const run = (...flags) => parseArgs(['node', 'council.mjs', 'an idea', ...flags]);

  test('rejects a flag with no value instead of swallowing the next token', () => {
    assert.throws(() => run('--context'), /--context requires a value/);
    assert.throws(() => run('--session-dir'), /--session-dir requires a value/);
    assert.throws(() => run('--context', '--services'), /--context requires a value/);
  });

  test('--round must be a positive integer with a value', () => {
    assert.throws(() => run('--round', 'abc'), /--round must be a positive integer/);
    assert.throws(() => run('--round', '0'), /--round must be a positive integer/);
    assert.throws(() => run('--round'), /--round requires a value/);
  });

  test('parses a multi-round session invocation', () => {
    const parsed = run('--session-dir', '/tmp/s', '--round', '3', '--services', 'a,b');
    assert.equal(parsed.sessionDir, '/tmp/s');
    assert.equal(parsed.round, 3);
    assert.deepEqual(parsed.services, ['a', 'b']);
    assert.equal(parsed.idea, 'an idea');
  });

  test('defaults: no session dir, round 1', () => {
    const parsed = run();
    assert.equal(parsed.sessionDir, null);
    assert.equal(parsed.round, 1);
  });
});

describe('VERDICT_SCHEMA', () => {
  test('requires uncertainties so blind judges flag what they cannot verify', () => {
    assert.ok(VERDICT_SCHEMA.required.includes('uncertainties'), 'uncertainties is required');
    assert.ok(VERDICT_SCHEMA.properties.uncertainties, 'uncertainties is a declared property');
    assert.equal(VERDICT_SCHEMA.properties.uncertainties.type, 'array');
    assert.equal(VERDICT_SCHEMA.additionalProperties, false, 'strict schema, no extra fields');
  });
});

describe('resolveRoundDir', () => {
  test('groups every round under one session dir as round-<n>', () => {
    const session = '/vault/council/my-idea';
    assert.equal(resolveRoundDir({ sessionDir: session, round: 1 }), join(session, 'round-1'));
    assert.equal(resolveRoundDir({ sessionDir: session, round: 3 }), join(session, 'round-3'));
    assert.equal(resolveRoundDir({ sessionDir: session }), join(session, 'round-1'), 'defaults to round 1');
  });
});

describe('resolveRunsDir / makeRunDir', () => {
  test('config.runs_dir wins, then workspace, then cwd fallback', () => {
    const cwd = tmp();
    const ws = tmp();
    assert.equal(
      resolveRunsDir({ config: { runs_dir: '/vault/council' }, workspaceRoot: ws, cwd }),
      '/vault/council',
    );
    assert.equal(
      resolveRunsDir({ config: {}, workspaceRoot: ws, cwd }),
      join(ws, '.spec-workspace', 'council'),
    );
    assert.equal(resolveRunsDir({ config: {}, workspaceRoot: null, cwd }), join(cwd, 'council-runs'));
  });

  test('slug collision gets a suffix instead of clobbering', () => {
    const base = tmp();
    const first = makeRunDir(base, 'my-idea');
    const second = makeRunDir(base, 'my-idea');
    assert.notEqual(first, second);
    assert.ok(existsSync(first) && existsSync(second));
    assert.match(second, /my-idea-\d+/);
  });
});

describe('detectJudges', () => {
  test('api requires the key; clis require the binary; neither → empty roster', () => {
    const which = (bin) => bin === 'gemini';
    const withKey = detectJudges({ env: { OPENROUTER_API_KEY: 'sk' }, whichImpl: which });
    assert.equal(withKey.api, true);
    assert.deepEqual(withKey.clis, ['gemini']);

    const without = detectJudges({ env: {}, whichImpl: () => false });
    assert.equal(without.api, false);
    assert.deepEqual(without.clis, []);
  });
});

describe('fanOutApi against a mocked OpenRouter (E2E-lite)', () => {
  const verdict = {
    verdict: 'GO_WITH_CONDITIONS',
    refutations: ['too coupled'],
    tradeoffs: ['cost'],
    conditions: ['add tests'],
    evidence_from_repo: ['case file'],
    uncertainties: [],
  };
  let server;
  let baseUrl;
  let sawRetryWithoutSchema = false;

  const start = () =>
    new Promise((resolve) => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const { model, response_format } = JSON.parse(body);
          if (model === 'mock/ok' || model === 'anthropic/claude-mock') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(verdict) } }] }));
          } else if (model === 'mock/rate-limited') {
            res.writeHead(429, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'rate limited' } }));
          } else if (model === 'mock/no-schema') {
            if (response_format) {
              res.writeHead(400, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ error: { message: 'response_format not supported' } }));
            } else {
              sawRetryWithoutSchema = true;
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(verdict) + '\n```' } }] }));
            }
          } else if (model === 'mock/slow') {
            // never responds — exercises AbortSignal timeout
          } else if (model === 'mock/empty') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { content: '   ' } }] }));
          }
        });
      });
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

  after(() => server?.close());

  test('mixed roster: ok, 429, timeout, 400-retry and empty all become envelopes — no judge sinks the jury', async () => {
    await start();
    const envelopes = await fanOutApi({
      models: ['mock/ok', 'mock/rate-limited', 'mock/slow', 'mock/no-schema', 'mock/empty', 'anthropic/claude-mock'],
      prompt: 'brief',
      apiKey: 'sk-test',
      baseUrl,
      // Headroom, not speed: only mock/slow should time out (it never responds). Under a
      // loaded event loop a tight budget lets the responsive mocks (esp. the 429) lose the
      // race to AbortSignal and misclassify as 'timeout'. 2s keeps mock/slow bounded while
      // the others reliably win.
      timeoutMs: 2000,
      maxTokens: 100,
      dataCollection: 'deny',
    });

    const byModel = Object.fromEntries(envelopes.map((e) => [e.judge, e]));
    assert.equal(byModel['mock/ok'].status, 'ok');
    assert.equal(byModel['mock/ok'].verdict.verdict, 'GO_WITH_CONDITIONS');
    assert.ok(byModel['mock/ok'].word_count > 0);
    assert.equal(byModel['mock/ok'].transport, 'openrouter');
    assert.equal(byModel['mock/ok'].same_family_as_arbiter, false);

    assert.equal(byModel['mock/rate-limited'].status, 'http_error');
    assert.match(byModel['mock/rate-limited'].error, /429/);

    assert.equal(byModel['mock/slow'].status, 'timeout');

    assert.equal(byModel['mock/no-schema'].status, 'ok', '400 on response_format retries once without it');
    assert.equal(sawRetryWithoutSchema, true);

    assert.equal(byModel['mock/empty'].status, 'empty');

    assert.equal(byModel['anthropic/claude-mock'].same_family_as_arbiter, true);

    for (const e of envelopes) assert.ok(Number.isFinite(e.elapsed_ms));
  });
});
