import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
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

describe('installer manifests — boot-certification chain shipped everywhere', () => {
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
