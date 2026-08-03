import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const SURFACE_DIRS = ['jelou', 'agents', 'skills'];
const FORBIDDEN = /\$\{?PLUGIN_ROOT(?::-\.)?\}?\/bin\/([a-z0-9-]+\.mjs)/g;

const KNOWN_UNRESOLVED = [
  ['agents/jlu-build-validator.md', 'runtime-exec.mjs'],
  ['agents/jlu-deps-validator.md', 'install-dep.mjs'],
  ['agents/jlu-implementer.md', 'install-dep.mjs'],
  ['agents/jlu-refactor-agent.md', 'install-dep.mjs'],
  ['jelou/references/docker-conventions.md', 'install-dep.mjs'],
  ['jelou/workflows/close-task.md', 'trace-end-span.mjs'],
  ['jelou/workflows/close-task.md', 'trace-feedback.mjs'],
  ['jelou/workflows/close-task.md', 'trace-snapshot-task.mjs'],
  ['jelou/workflows/close-task.md', 'trace-start-span.mjs'],
  ['jelou/workflows/execute-task.md', 'trace-end-span.mjs'],
  ['jelou/workflows/execute-task.md', 'trace-reconcile.mjs'],
  ['jelou/workflows/execute-task.md', 'trace-start-span.mjs'],
  ['jelou/workflows/execute-task.md', 'trace-suggest.mjs'],
  ['jelou/workflows/new-task.md', 'trace-end-span.mjs'],
  ['jelou/workflows/new-task.md', 'trace-start-span.mjs'],
  ['jelou/workflows/refine-task.md', 'trace-end-span.mjs'],
  ['jelou/workflows/refine-task.md', 'trace-reconcile.mjs'],
  ['jelou/workflows/refine-task.md', 'trace-start-span.mjs'],
  ['jelou/workflows/refine-task.md', 'trace-suggest.mjs'],
  ['jelou/workflows/refine-task.md', 'validate-stories.mjs'],
  ['jelou/workflows/report-task.md', 'trace-end-span.mjs'],
  ['jelou/workflows/report-task.md', 'trace-start-span.mjs'],
  ['jelou/workflows/ship.md', 'trace-end-span.mjs'],
  ['jelou/workflows/ship.md', 'trace-reconcile.mjs'],
  ['jelou/workflows/ship.md', 'trace-start-span.mjs'],
  ['jelou/workflows/ship.md', 'trace-suggest.mjs'],
];

function markdownSurfaces() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = join(dir, entry);
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (entry.endsWith('.md')) out.push(rel.split('\\').join('/'));
    }
  };
  for (const dir of SURFACE_DIRS) walk(dir);
  return out.sort();
}

function forbiddenInvocations() {
  const found = new Set();
  for (const surface of markdownSurfaces()) {
    for (const match of read(surface).matchAll(FORBIDDEN)) {
      found.add(`${surface} → ${match[1]}`);
    }
  }
  return found;
}

describe('plugin-root resolution — the PLUGIN_ROOT shell form is a ratchet', () => {
  const known = new Set(KNOWN_UNRESOLVED.map(([surface, bin]) => `${surface} → ${bin}`));

  test('no surface adds a new ${PLUGIN_ROOT}/bin invocation', () => {
    const added = [...forbiddenInvocations()].filter((entry) => !known.has(entry));
    assert.deepEqual(
      added,
      [],
      'no runtime exports PLUGIN_ROOT, so these collapse to ./bin/<script> inside the user repo. ' +
        'Resolve the root from the surface path instead — see jelou/references/plugin-root.md',
    );
  });

  test('a fixed invocation is removed from the ratchet list', () => {
    const stale = [...known].filter((entry) => !forbiddenInvocations().has(entry));
    assert.deepEqual(stale, [], 'these no longer use the shell form — delete them from KNOWN_UNRESOLVED');
  });

  test('every ratcheted surface and bin actually exists', () => {
    for (const [surface, bin] of KNOWN_UNRESOLVED) {
      assert.doesNotThrow(() => read(surface), `${surface} is listed but missing`);
      assert.doesNotThrow(() => read(`bin/${bin}`), `bin/${bin} is listed but missing`);
    }
  });
});

describe('plugin-root reference — states the rule once', () => {
  const reference = 'jelou/references/plugin-root.md';
  const body = read(reference);

  test('names the layout invariant for every surface kind', () => {
    for (const fragment of [
      '<root>/jelou/workflows/',
      '<root>/agents/',
      '<root>/skills/',
      '<root>/.codex/skills/',
      '<root>/bin/',
    ]) {
      assert.ok(body.includes(fragment), `${reference} does not document ${fragment}`);
    }
  });

  test('covers all six install paths', () => {
    for (const fragment of [
      'codex plugin add',
      'bin/install-codex.sh',
      'bin/install-opencode.sh',
      '$CODEX_HOME',
      '$OPENCODE_HOME',
      'marketplace',
    ]) {
      assert.ok(body.includes(fragment), `${reference} does not cover ${fragment}`);
    }
  });

  test('forbids the shell form and scopes CLAUDE_PLUGIN_ROOT to hooks', () => {
    assert.match(body, /Never use `\$\{PLUGIN_ROOT:-\.\}`/);
    assert.match(body, /hooks\/hooks\.json/);
  });

  test('states the shipping requirement with both installers and the test', () => {
    assert.match(body, /FEATURE_BINS/);
    assert.match(body, /installer-manifest\.test\.mjs/);
  });

  test('list-tasks cites the reference instead of restating the rule', () => {
    assert.match(read('jelou/workflows/list-tasks.md'), /jelou\/references\/plugin-root\.md/);
  });
});
