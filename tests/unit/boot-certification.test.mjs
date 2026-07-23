import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const mapCodebase = read('jelou/workflows/map-codebase.md');
const goal = read('jelou/workflows/goal.md');
const uiQaRun = read('jelou/workflows/ui-qa-run.md');
const schema = read('jelou/references/dev-block-schema.md');
const template = read('jelou/templates/services-yaml.md');

describe('boot certification surfaces', () => {
  test('verify adapter, shared-reuse executor, and verifier agent exist', () => {
    for (const rel of [
      'bin/verify-dev-block.mjs',
      'bin/lib/boot-engine/execute-shared-reuse.mjs',
      'agents/jlu-dev-block-verifier.md',
    ]) {
      assert.ok(existsSync(join(ROOT, rel)), `missing ${rel}`);
    }
  });
});

describe('map-codebase Step 7c — single-service certification', () => {
  test('derives, persists, then dispatches one verifier, all fail-soft', () => {
    assert.match(mapCodebase, /Certify the `dev` block \(fail-soft/);
    assert.match(mapCodebase, /derive-dev-block\.mjs <SOURCE_ROOT> --stack/);
    assert.match(mapCodebase, /--persist-block --workspace <WORKSPACE_PATH> --service <service-id> --block-file -/);
    assert.match(mapCodebase, /ONE dispatch of `jlu-dev-block-verifier`/);
    assert.match(mapCodebase, /jlu:jlu-dev-block-verifier/);
    assert.match(mapCodebase, /may block the docs deliverable/);
  });

  test('marks only GREEN verdicts whose command actually executed', () => {
    assert.match(schema, /VERDICT: GREEN \| GREEN_PREEXISTING \| FAILED \| ERROR/);
    assert.match(schema, /## `verify-dev-block\.mjs` — CLI contract \(canonical\)/);
    assert.match(schema, /`0` green · `3` green-preexisting/);
    assert.match(schema, /\{ status, cause, readiness_ms, commit, command_executed,\s*teardown_clean, block_hash \}/);
    assert.match(mapCodebase, /dev-block-schema\.md.*CLI contract/);
    assert.doesNotMatch(mapCodebase, /exit `0` green \/ `3` green-preexisting/);
    assert.match(mapCodebase, /`VERDICT: GREEN` with `COMMAND_EXECUTED: true`/);
    assert.match(mapCodebase, /--write-mark --workspace <WORKSPACE_PATH> --service <service-id> --commit/);
    assert.match(mapCodebase, /`VERDICT: GREEN_PREEXISTING` → NO mark/);
    assert.match(mapCodebase, /`VERDICT: FAILED` or `ERROR` → NO mark; WARN with the returned `CAUSE`/);
  });

  test('exit 3 is a recorded note that never blocks the docs', () => {
    assert.match(mapCodebase, /exit `3` \(not derivable/);
    assert.match(mapCodebase, /`exit-3\(<reason>\)`/);
  });

  test('re-runs heal a missing dev block, not only a missing registry entry', () => {
    assert.match(mapCodebase, /heal a missing registry entry or a missing `dev` block/);
    assert.match(mapCodebase, /an entry registered by an earlier run without a `dev` block gets one now/i);
  });

  test('verifier reports and the orchestrator persists', () => {
    assert.match(mapCodebase, /never edits the registry — it reports, the orchestrator persists/);
  });
});

describe('map-codebase batch — B6 derivation + B6b sequential verification', () => {
  test('B6 derives and persists orchestrator-side, mappers stay forbidden', () => {
    assert.match(mapCodebase, /Derive \+ persist missing `dev` blocks \(orchestrator-side, fail-soft\)/);
    assert.match(mapCodebase, /Mapper workers remain forbidden from registry writes and subagent dispatch/);
    assert.match(mapCodebase, /only orchestrator-side, here and in B6b/);
  });

  test('B6b runs one verifier at a time under the RAM-gate discipline', () => {
    assert.match(mapCodebase, /### B6b\. Sequential Dev-Block Verification/);
    assert.match(mapCodebase, /one verifier dispatch at a time, concurrency 1, never\s+in parallel/);
    assert.match(mapCodebase, /RAM-gate discipline/);
  });

  test('B6b covers freshly derived AND pre-existing unmarked blocks via the hash check', () => {
    assert.match(mapCodebase, /--hash --workspace <WORKSPACE_PATH> --service <service-id>/);
    assert.match(mapCodebase, /pre-existing hand-authored blocks that were never certified/);
    assert.match(mapCodebase, /hand-edited after marking\s+and counts as unmarked/);
    assert.match(mapCodebase, /already-marked blocks are never re-verified/);
  });

  test('B8 report carries every certification state', () => {
    assert.match(mapCodebase, /\| Service \| Source \| Result \| Registry \| Certification \| Notes \|/);
    for (const state of [
      'derived+verified',
      'derived-unverified(<cause>)',
      'pre-existing-verified',
      'pre-existing-unverified(<cause>)',
      'green-preexisting',
      'exit-3(<reason>)',
      'already-verified',
    ]) {
      assert.ok(mapCodebase.includes(state), `missing certification state ${state}`);
    }
  });

  test('states the stack-down precondition and never stops a running dev process', () => {
    assert.match(mapCodebase, /the dev\s+stack should be DOWN/);
    assert.match(mapCodebase, /mass `green-preexisting`/);
    assert.match(mapCodebase, /NEVER stops a running dev process/);
  });
});

describe('goal step 8b — auto-repair without questions', () => {
  test('the old AskUserQuestion dev-block menu is gone', () => {
    assert.ok(!goal.includes('Write and continue'));
    assert.ok(!goal.includes("I'll edit it myself"));
    assert.ok(!goal.includes('Skip this service'));
    assert.match(goal, /NEVER improvise, NEVER ask/);
  });

  test('a missing block is derived and persisted with no mark and no question', () => {
    assert.match(goal, /Derivable — persist without asking, without marking/);
    assert.match(goal, /--persist-block --workspace <workspace> --service <service> --block-file -/);
    assert.match(goal, /No question is asked and no `verified` mark is written/);
  });

  test('trust rule: a marked block with a current hash boots normally without re-marking', () => {
    assert.match(goal, /verified: \{ date, commit, block_hash \}/);
    assert.match(goal, /--hash --workspace <workspace> --service <service>/);
    assert.match(goal, /trust it: boot normally in Phase 2, never re-verify,\s+never re-mark/);
  });

  test('the run\'s own boot is the verification — no double boot, no verifier dispatch', () => {
    assert.match(goal, /the run's normal Phase 2 boot IS the verification/);
    assert.match(goal, /exists only in\s+`\/jlu-map-codebase`, where no run boots/);
  });

  test('marks only a boot that started the service on the canonical checkout', () => {
    assert.match(goal, /this boot actually \*\*STARTED\*\* the service/);
    assert.match(goal, /reuse of an already-healthy service never\s+marks/);
    assert.match(goal, /`BOOTED\[\]` membership or any other\s+inference does not qualify/);
    assert.match(goal, /canonical `svc\.path`\*\* — a worktree boot trusts or\s+re-verifies but NEVER writes the mark/);
  });

  test('a failed boot refuses with the cause and never marks', () => {
    assert.match(goal, /otherwise refuse with the cause/);
    assert.match(goal, /A boot failure never writes a mark/);
  });

  test('exit-3 keeps the current refuse message', () => {
    assert.match(goal, /Add a `dev` block under `<service>` in `\.spec-workspace\/registry\/services\.yaml`/);
    assert.match(goal, /this refuse\s+message is unchanged/);
  });

  test('skip-unbootable table auto-skips backends only and never drops a UI service', () => {
    assert.match(goal, /--skip-unbootable/);
    assert.match(goal, /exit-3 or verification-failed, backend service \| informative refuse/);
    assert.match(goal, /the flag NEVER drops a UI service/);
    assert.match(goal, /do NOT overload `--force`/);
  });
});

describe('ui-qa-run step 14a — mark ownership', () => {
  test('marks only when this run owns the boot, canonical checkout only', () => {
    assert.match(uiQaRun, /only when this run OWNS the boot/);
    assert.match(uiQaRun, /--write-mark --workspace <workspace> --service <id> --commit/);
    assert.match(uiQaRun, /canonical `svc\.path` \(a worktree boot never writes the mark\)/);
    assert.match(uiQaRun, /reuse of an already-healthy service never marks/);
  });

  test('never writes under --no-boot and never derives missing blocks', () => {
    assert.match(uiQaRun, /Under `--no-boot` this step NEVER writes/);
    assert.match(uiQaRun, /never derives a missing\s+`dev` block/);
    assert.match(uiQaRun, /still skipped per step 6/);
  });
});

describe('dev-block schema — the verified mark', () => {
  test('documents the shape and each field', () => {
    assert.match(schema, /verified: \{ date, commit, block_hash \}/);
    assert.match(schema, /`commit` — short HEAD sha of the checkout that was ACTUALLY booted/);
    assert.match(schema, /EXCLUDING the `verified` key/);
  });

  test('a manual edit invalidates the mark mechanically', () => {
    assert.match(schema, /invalidates the mark\s+MECHANICALLY, not by convention/);
    assert.match(schema, /hash mismatch ⇒ the block is treated as unmarked and is\s+re-verified by the next run's own boot/);
  });

  test('lists the writers per invocation mode and bars the verifier subagent', () => {
    assert.match(schema, /Step 7c \(single-service\) and the B6b batch phase/);
    assert.match(schema, /their OWN boot actually STARTED the\s+service/);
    assert.match(schema, /Worktree boots trust or\s+re-verify but NEVER write the mark/);
    assert.match(schema, /Under `--no-boot`, `\/jlu-ui-qa-run` NEVER writes/);
    assert.match(schema, /`jlu-dev-block-verifier` subagent NEVER writes the mark/);
  });

  test('scopes the mark to shared-reuse standalone startup mechanics', () => {
    assert.match(schema, /standalone\s+startup MECHANICS of the shared-reuse boot path only/);
    assert.match(schema, /does NOT certify\s+runtime integration with peer services/i);
    assert.match(schema, /task-isolated boot path[\s\S]{0,120}outside this contract/);
  });
});

describe('cross-references and conflict handling', () => {
  test('map-codebase and goal reference the verify adapter and the verifier agent', () => {
    for (const [name, wf] of [['map-codebase', mapCodebase], ['goal', goal]]) {
      assert.match(wf, /verify-dev-block\.mjs/, name);
      assert.match(wf, /jlu-dev-block-verifier/, name);
    }
    assert.match(uiQaRun, /verify-dev-block\.mjs/);
  });

  test('the mtime-conflict retry-once rule appears wherever persist or mark is invoked', () => {
    assert.match(mapCodebase, /mtime conflict[\s\S]{0,120}re-read the registry and retry once/);
    assert.match(mapCodebase, /re-read-and-retry-once/);
    assert.match(goal, /exit `5` = mtime conflict[\s\S]{0,120}retry once/);
    assert.match(uiQaRun, /exit `5` = mtime conflict → re-read the registry and retry once/);
  });

  test('services-yaml template notes mapping-time certification and goal auto-repair', () => {
    assert.match(template, /derives, boot-verifies, and persists missing `dev` blocks at mapping time/);
    assert.match(template, /verified: \{date, commit, block_hash\}/);
    assert.match(template, /`\/jlu-goal` auto-repairs without asking/);
  });
});
