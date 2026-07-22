import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES } from '../../bin/head-sha-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const workflow = read('jelou/workflows/resolve-pr.md');
const skill = read('skills/resolve-pr/SKILL.md');

describe('resolve-pr harness surfaces', () => {
  test('skill, workflow, opencode command, and sonar references exist', () => {
    for (const rel of [
      'skills/resolve-pr/SKILL.md',
      'jelou/workflows/resolve-pr.md',
      '.opencode/commands/jlu-resolve-pr.md',
      'jelou/references/sonar-risk-rubric.md',
      'jelou/references/sonar-test-detection.md',
      'bin/head-sha-guard.mjs',
    ]) {
      assert.ok(existsSync(join(ROOT, rel)), `missing ${rel}`);
    }
  });

  test('skill exposes the autonomous flag and routes to the workflow', () => {
    assert.match(skill, /--autonomous/);
    assert.match(skill, /jelou\/workflows\/resolve-pr\.md/);
    assert.match(skill, /mcp__sonarqube__/);
  });

  test('opencode command resolves the resolve-pr workflow', () => {
    const cmd = read('.opencode/commands/jlu-resolve-pr.md');
    assert.match(cmd, /jelou\/workflows\/resolve-pr\.md/);
    assert.match(cmd, /--autonomous/);
  });
});

describe('resolve-pr autonomous-mode doctrine', () => {
  test('ask-paths never apply in autonomous mode', () => {
    assert.match(workflow, /skip, rerun, or escalate — never apply/);
  });

  test('security comments and SECURITY sonar clusters escalate in autonomous mode', () => {
    assert.match(workflow, /\*\*security\*\* comments and \*\*SECURITY\*\* Sonar clusters\s*escalate/);
  });

  test('conflict ask-paths abort the merge before escalating', () => {
    assert.match(workflow, /`git merge --abort` BEFORE escalating/);
  });

  test('dirty working tree escalates in autonomous mode', () => {
    assert.match(workflow, /autonomous: escalate \(`dirty-working-tree`\)/);
  });

  test('escalations carry a resume command and fire notifyOs', () => {
    assert.match(workflow, /Resume: \/jlu-resolve-pr <pr-url>/);
    assert.match(workflow, /notifyOs/);
  });
});

describe('resolve-pr loop correctness invariants', () => {
  test('review-arrival gate exists with a bounded review_wait', () => {
    assert.match(workflow, /## Step 4 — Review-arrival gate \(autonomous only\)/);
    assert.match(workflow, /review_wait/);
  });

  test('done-gate requires both halves: terminal checks and resolved threads', () => {
    assert.match(workflow, /checks\.length > 0/);
    assert.match(workflow, /No unresolved actionable review threads remain/);
    assert.match(workflow, /wait `review_wait` once more and re-fetch/);
  });

  test('fix cycles are bounded to 2 and thrash is detected', () => {
    assert.match(workflow, /at most 2 fix→push→watch cycles per PR/);
    assert.match(workflow, /same-signature failure/);
    assert.match(workflow, /`thrash-detected`/);
  });

  test('every push is guarded by head-sha-guard and force-push is banned', () => {
    assert.match(workflow, /bin\/head-sha-guard\.mjs/);
    assert.match(workflow, /Never force-push, in any\s*mode/);
    assert.match(workflow, /never rebase/i);
  });

  test('guard contract is fail-closed and workflow prose matches EXIT_CODES', () => {
    assert.match(workflow, /\*\*Fail closed\*\*/);
    assert.match(workflow, /JSON `message` from stdout/);
    assert.match(workflow, new RegExp(`exit ${EXIT_CODES.ok} \\(\`ok\`\\)`));
    assert.match(workflow, new RegExp(`exit ${EXIT_CODES.moved} \\(\`moved\`\\)`));
    assert.match(workflow, new RegExp(`exit ${EXIT_CODES.error} \\(\`error\`\\)`));
    assert.match(workflow, /anything else \(empty stdout, crash\) → treat as `error`; never push/);
  });

  test('handled thread ids are never re-fixed across re-fetches', () => {
    assert.match(workflow, /handled-ids set/);
  });
});

describe('resolve-pr sonar phase', () => {
  test('sonar phase is gated on repo signal and skips silently otherwise', () => {
    assert.match(workflow, /## Step 8 — Sonar quality phase \(gated\)/);
    assert.match(workflow, /No signal → skip silently/);
  });

  test('sonar red checks route to the sonar phase, not the external-provider ask-path', () => {
    assert.match(workflow, /Route to \*\*Step 8\*\*/);
  });

  test('autonomous sonar is shallow and structural/security clusters escalate', () => {
    assert.match(workflow, /Autonomous: always\s*\*\*shallow\*\*/);
    const clusterTable = workflow.slice(workflow.indexOf('**8.4 Classify'));
    assert.match(clusterTable, /STRUCTURAL[\s\S]*?\*\*Escalate\*\*/);
  });

  test('hotspots are never auto-marked SAFE in any mode', () => {
    assert.match(workflow, /never mark SAFE without an\s*explicit user justification, in any mode/);
  });

  test('closure re-scan is bounded and references the ported rubric and test-detection docs', () => {
    assert.match(workflow, /jelou\/references\/sonar-risk-rubric\.md/);
    assert.match(workflow, /jelou\/references\/sonar-test-detection\.md/);
    assert.match(workflow, /Reconcile bounded to\s*\*\*2 iterations\*\*/);
  });

  test('sonar rules are never disabled to silence issues', () => {
    assert.match(workflow, /never disable a rule to silence an\s*issue/);
  });
});
