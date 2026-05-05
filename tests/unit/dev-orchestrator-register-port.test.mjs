// tests/unit/dev-orchestrator-register-port.test.mjs
import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inferPortFromSource, inferDefaults } from '../../bin/lib/dev-orchestrator/register.mjs';

function tmp() { return mkdtempSync(join(tmpdir(), 'jlu-port-')); }

describe('inferPortFromSource', () => {
  test('detects PORT in .env', () => {
    const dir = tmp();
    writeFileSync(join(dir, '.env'), 'PORT=3001\nFOO=bar\n');
    assert.equal(inferPortFromSource(dir), 3001);
    rmSync(dir, { recursive: true, force: true });
  });

  test('detects app.listen(N) in JS file', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'index.js'), 'const app = require("express")();\napp.listen(4242, () => {});\n');
    assert.equal(inferPortFromSource(dir), 4242);
    rmSync(dir, { recursive: true, force: true });
  });

  test('detects PORT=N in package.json scripts', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      scripts: { start: 'PORT=8080 node index.js' }
    }));
    assert.equal(inferPortFromSource(dir), 8080);
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns null when no port found', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'README.md'), 'just docs\n');
    assert.equal(inferPortFromSource(dir), null);
    rmSync(dir, { recursive: true, force: true });
  });

  test('does not recurse into subdirectories', () => {
    const dir = tmp();
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, '.env'), 'PORT=9999\n');
    assert.equal(inferPortFromSource(dir), null);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('inferDefaults — port + suggestedReadinessUrl', () => {
  test('exposes detectedPort and suggestedReadinessUrl when port detectable', () => {
    const dir = tmp();
    writeFileSync(join(dir, '.env'), 'PORT=5555\n');
    const out = inferDefaults(dir);
    assert.equal(out.detectedPort, 5555);
    assert.equal(out.suggestedReadinessUrl, 'http://localhost:5555/health');
    rmSync(dir, { recursive: true, force: true });
  });

  test('returns null fields when no port detectable', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'README.md'), 'no ports here\n');
    const out = inferDefaults(dir);
    assert.equal(out.detectedPort, null);
    assert.equal(out.suggestedReadinessUrl, null);
    rmSync(dir, { recursive: true, force: true });
  });
});
