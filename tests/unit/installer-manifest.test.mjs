import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const INSTALLERS = ['bin/install-codex.sh', 'bin/install-opencode.sh'];

const FEATURE_BINS = [
  'bin/derive-dev-block.mjs',
  'bin/verify-dev-block.mjs',
  'bin/lib/registry/yaml-lite.mjs',
  'bin/lib/registry/splice.mjs',
  'bin/lib/boot-engine/execute-shared-reuse.mjs',
  'bin/lib/dev-orchestrator/readiness.mjs',
  'bin/list-tasks.mjs',
  'bin/task-index.mjs',
  'bin/boot-dev-server.mjs',
  'bin/build-boot-plan.mjs',
  'bin/classify-e2e-target.mjs',
  'bin/classify-task-scope.mjs',
  'bin/detect-auth-collapse.mjs',
  'bin/e2e-ensure-account.mjs',
  'bin/e2e-login-local.mjs',
  'bin/e2e-login.mjs',
  'bin/e2e-session-probe.mjs',
  'bin/e2e-session-sync.mjs',
  'bin/extract-trace.mjs',
  'bin/parse-goal-matrix.mjs',
  'bin/probe-coverage-breadth.mjs',
  'bin/seed-e2e-settings.mjs',
  'bin/daily-slack-assemble.mjs',
  'bin/daily-slack-bucket.mjs',
  'bin/daily-slack-compose.mjs',
  'bin/daily-slack-extract-reason.mjs',
  'bin/daily-slack-format-meetings.mjs',
  'bin/daily-slack-meetings-window.mjs',
  'bin/daily-slack-render.mjs',
  'bin/daily-slack-scan-urls.mjs',
  'bin/install-dep.mjs',
  'bin/jlu-settings.mjs',
  'bin/plan-phase-waves.mjs',
  'bin/runtime-exec.mjs',
  'bin/trace-end-span.mjs',
  'bin/trace-eval.mjs',
  'bin/trace-export-otlp.mjs',
  'bin/trace-feedback.mjs',
  'bin/trace-reconcile.mjs',
  'bin/trace-snapshot-task.mjs',
  'bin/trace-start-span.mjs',
  'bin/trace-suggest.mjs',
  'bin/validate-stories.mjs',
];

function shippedBins(installerText) {
  const shipped = new Set();
  for (const line of installerText.split('\n')) {
    const m = line.match(/cp\s+"\$PLUGIN_DIR\/(bin\/[^"]+)"/);
    if (m) shipped.add(m[1]);
  }
  return shipped;
}

function relativeImports(rel) {
  const dir = dirname(rel);
  const out = [];
  for (const m of read(rel).matchAll(/from\s+'(\.[^']+)'/g)) {
    const resolved = join(dir, m[1]).split('\\').join('/');
    out.push(resolved);
  }
  return out;
}

describe('installer manifests — every feature bin ships everywhere', () => {
  for (const installer of INSTALLERS) {
    const shipped = shippedBins(read(installer));

    for (const bin of FEATURE_BINS) {
      test(`${installer} ships ${bin}`, () => {
        assert.ok(shipped.has(bin), `${bin} missing from ${installer} whitelist`);
      });
    }

    test(`${installer} import graph of shipped .mjs files is closed`, () => {
      const queue = [...shipped].filter((f) => f.endsWith('.mjs'));
      const seen = new Set(queue);
      while (queue.length) {
        const file = queue.pop();
        assert.ok(existsSync(join(ROOT, file)), `${file} listed in ${installer} but does not exist`);
        for (const dep of relativeImports(file)) {
          assert.ok(
            shipped.has(dep),
            `${file} imports ${dep}, which ${installer} does not ship`,
          );
          if (!seen.has(dep)) {
            seen.add(dep);
            queue.push(dep);
          }
        }
      }
    });
  }
});

const DELIBERATELY_UNSHIPPED = new Map([
  [
    'bin/sync-codex.mjs',
    'a repo-development script: it regenerates .codex/ mirrors from skills/ and agents/, ' +
      'neither of which exists in an install. Referenced only as an instruction to plugin developers.',
  ],
]);

function surfaceMarkdownFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = join(dir, entry);
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (entry.endsWith('.md')) out.push(rel.split('\\').join('/'));
    }
  };
  for (const dir of ['jelou', 'agents', 'skills']) walk(dir);
  return out.sort();
}

function referencedBins() {
  const refs = new Map();
  for (const surface of surfaceMarkdownFiles()) {
    for (const match of read(surface).matchAll(/bin\/[a-z0-9-]+\.mjs/g)) {
      if (!refs.has(match[0])) refs.set(match[0], []);
      refs.get(match[0]).push(surface);
    }
  }
  return refs;
}

describe('installer manifests — every referenced bin is shipped', () => {
  const referenced = referencedBins();

  for (const installer of INSTALLERS) {
    test(`${installer} ships every bin a workflow, agent or skill invokes`, () => {
      const shipped = shippedBins(read(installer));
      const gaps = [...referenced.keys()]
        .filter((bin) => !shipped.has(bin) && !DELIBERATELY_UNSHIPPED.has(bin))
        .map((bin) => `${bin} (referenced by ${referenced.get(bin).join(', ')})`);
      assert.deepEqual(
        gaps,
        [],
        `absent from ${installer}, so a script install leaves these unreachable. ` +
          'Add a cp line plus its bin/lib imports to BOTH installers, or declare the exclusion in ' +
            'DELIBERATELY_UNSHIPPED. See jelou/references/plugin-root.md for the layout invariant, ' +
            'the six install paths, and how a surface must resolve the root.',
      );
    });
  }

  test('every deliberate exclusion is still referenced and still absent', () => {
    for (const [bin, why] of DELIBERATELY_UNSHIPPED) {
      assert.ok(referenced.has(bin), `${bin} is excluded but no surface references it — drop the entry`);
      assert.ok(why.length > 40, `${bin} needs a real justification, not a placeholder`);
      for (const installer of INSTALLERS) {
        assert.ok(
          !shippedBins(read(installer)).has(bin),
          `${bin} is listed as deliberately unshipped but ${installer} ships it — drop the entry`,
        );
      }
    }
  });
});

describe('list-tasks — the scanner is reachable on every runtime', () => {
  const workflow = read('jelou/workflows/list-tasks.md');

  test('the scanner is not invoked through the undefined PLUGIN_ROOT fallback', () => {
    assert.doesNotMatch(
      workflow,
      /\$\{PLUGIN_ROOT:-\.\}\/bin\/list-tasks\.mjs/,
      'no runtime exports PLUGIN_ROOT, so this collapses to ./bin/list-tasks.mjs inside the service repo',
    );
  });

  test('the workflow invokes the scanner through a substitutable placeholder, not a shell variable', () => {
    assert.match(workflow, /<root>\/bin\/list-tasks\.mjs/);
  });

  for (const installer of INSTALLERS) {
    test(`${installer} ships the whole task-index chain`, () => {
      const shipped = shippedBins(read(installer));
      for (const bin of [
        'bin/list-tasks.mjs',
        'bin/task-index.mjs',
        'bin/lib/task-index/extract.mjs',
        'bin/lib/task-index/scan.mjs',
        'bin/lib/task-index/render.mjs',
        'bin/lib/task-index/workspace.mjs',
      ]) {
        assert.ok(shipped.has(bin), `${bin} missing from ${installer}`);
      }
    });
  }
});

describe('boot-certification workflows — referenced bins exist in the repo', () => {
  const surfaces = [
    'jelou/workflows/map-codebase.md',
    'jelou/workflows/goal.md',
    'jelou/workflows/ui-qa-run.md',
    'agents/jlu-dev-block-verifier.md',
  ];

  test('every verify/derive invocation points at a real file', () => {
    for (const rel of surfaces) {
      for (const m of read(rel).matchAll(/bin\/(verify-dev-block|derive-dev-block)\.mjs/g)) {
        assert.ok(existsSync(join(ROOT, `bin/${m[1]}.mjs`)), `${rel} references missing bin/${m[1]}.mjs`);
      }
    }
  });
});
