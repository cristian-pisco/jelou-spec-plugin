import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyMountOutcome, summarizeMountFailure } from '../../bin/lib/app-mount.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('classifyMountOutcome', () => {
  test('static shell still present is pending', () => {
    assert.equal(
      classifyMountOutcome({
        initial: { shellPresent: true, rootChildCount: 1, rootHtmlLength: 500, interactiveCount: 0 },
        current: { shellPresent: true, rootChildCount: 1, rootHtmlLength: 500, interactiveCount: 0 },
      }),
      'pending',
    );
  });

  test('shell gone with interactive elements is mounted', () => {
    assert.equal(
      classifyMountOutcome({
        initial: { shellPresent: true, rootChildCount: 1, rootHtmlLength: 500, interactiveCount: 0 },
        current: { shellPresent: false, rootChildCount: 3, rootHtmlLength: 9000, interactiveCount: 12 },
      }),
      'mounted',
    );
  });

  test('shell gone but empty root is pending', () => {
    assert.equal(
      classifyMountOutcome({
        initial: { shellPresent: true, rootChildCount: 1, rootHtmlLength: 500, interactiveCount: 0 },
        current: { shellPresent: false, rootChildCount: 0, rootHtmlLength: 0, interactiveCount: 0 },
      }),
      'pending',
    );
  });

  test('no shell convention: material root growth counts as mounted', () => {
    assert.equal(
      classifyMountOutcome({
        initial: { shellPresent: false, rootChildCount: 0, rootHtmlLength: 40, interactiveCount: 0 },
        current: { shellPresent: false, rootChildCount: 2, rootHtmlLength: 5000, interactiveCount: 0 },
      }),
      'mounted',
    );
  });

  test('a null sample (mid-reload) is pending, never a crash verdict', () => {
    assert.equal(classifyMountOutcome({ initial: { rootHtmlLength: 100 }, current: null }), 'pending');
  });
});

describe('summarizeMountFailure', () => {
  test('carries the evidence the BLOCKED verdict must attach', () => {
    const line = summarizeMountFailure({
      elapsedS: 180,
      consoleErrors: 2,
      finalUrl: 'http://localhost:5173/channels',
      lastSample: { shellPresent: true, interactiveCount: 0 },
    });
    assert.match(line, /not_mounted after=180s/);
    assert.match(line, /console_errors=2/);
    assert.match(line, /shell_present=true/);
  });
});

describe('app-mount gate wiring', () => {
  test('ui-qa-run.md has the 14a\' gate and the step 17 UI exception', () => {
    const doc = read('jelou/workflows/ui-qa-run.md');
    assert.match(doc, /14a'\. \*\*App-mount gate/);
    assert.match(doc, /e2e-app-mount-probe\.mjs/);
    assert.match(doc, /never judge a UI service crashed from a one-shot check/i);
    assert.match(doc, /app_never_mounted/);
  });

  test('goal.md settles the UI lane before Phase 3', () => {
    const doc = read('jelou/workflows/goal.md');
    const gate = doc.indexOf('10b. **UI app-mount gate');
    const phase3 = doc.indexOf('### Phase 3 — Backend execution');
    assert.ok(gate > -1, 'goal.md must carry the 10b UI app-mount gate');
    assert.ok(gate < phase3, 'the UI app-mount gate must precede Phase 3');
    assert.match(doc, /app_never_mounted/);
  });

  test('jlu-ui-qa-runner declares the app_never_mounted reason and the full-budget re-probe', () => {
    const doc = read('agents/jlu-ui-qa-runner.md');
    assert.match(doc, /app_never_mounted/);
    assert.match(doc, /e2e-app-mount-probe\.mjs/);
  });

  test('dev-server-readiness.md no longer sells Vite Local: as app readiness', () => {
    const doc = read('jelou/references/dev-server-readiness.md');
    assert.match(doc, /\*\*server\*\*[\s\S]{0,20}readiness, not \*\*app\*\* readiness/);
    assert.match(doc, /e2e-app-mount-probe\.mjs/);
  });
});
