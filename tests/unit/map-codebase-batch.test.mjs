// tests/unit/map-codebase-batch.test.mjs
//
// Run: `node --test tests/unit/map-codebase-batch.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relPath) => readFileSync(join(ROOT, relPath), 'utf8');

describe('map-codebase workflow — root batch mode', () => {
  const workflow = read('jelou/workflows/map-codebase.md');

  test('selects batch mode from root/all flags and preserves single-service mode', () => {
    assert.match(workflow, /## Step 0 — Select Run Mode/);
    assert.match(workflow, /`--root`, `--root <path>`, `--root=<path>`, `--all`, or `--batch` set `RUN_MODE` = `batch`/);
    assert.match(workflow, /## Batch Root Mode — Map All Projects Under a Root/);
    assert.match(workflow, /## Single-Service Mode/);
    assert.match(workflow, /Stop before \*\*Single-Service Mode\*\*/);
  });

  test('discovers projects from registry and immediate root children', () => {
    assert.match(workflow, /Read `<WORKSPACE_PATH>\/registry\/services\.yaml`/);
    assert.match(workflow, /Scan immediate child directories of `ROOT_PATH`/);
    assert.match(workflow, /De-duplicate by absolute `SOURCE_ROOT`/);
    assert.match(workflow, /Registry entries win over scanned entries/);
  });

  test('dispatches one flat mapper per service with JLU_PHASE_PARALLELISM cap', () => {
    assert.match(workflow, /dispatches one `jlu-codebase-mapper`/);
    assert.match(workflow, /JLU_PHASE_PARALLELISM/);
    assert.match(workflow, /clamped to\s+`1\.\.len\(SERVICE_TARGETS\)`/);
    assert.match(workflow, /process chunks sequentially/);
    assert.match(workflow, /Do not invoke \/jlu-map-codebase/);
    assert.match(workflow, /Do not dispatch subagents or use task\/Agent/);
  });

  test('keeps shared writes in the root orchestrator', () => {
    assert.match(workflow, /Registry writes are shared state/);
    assert.match(workflow, /Write `services\.yaml` once/);
    assert.match(workflow, /writing a unique fragment/);
    assert.match(workflow, /run the merger exactly once/);
  });
});

describe('jlu-codebase-mapper agent', () => {
  const mapper = read('agents/jlu-codebase-mapper.md');

  test('exists in canonical and generated runtimes', () => {
    assert.ok(existsSync(join(ROOT, 'agents/jlu-codebase-mapper.md')));
    assert.ok(existsSync(join(ROOT, '.opencode/agents/jlu-codebase-mapper.md')));
    assert.ok(existsSync(join(ROOT, '.codex/agents/jlu-codebase-mapper.toml')));
  });

  test('forbids nested command and subagent dispatch', () => {
    assert.match(mapper, /Do not invoke `\/jlu-map-codebase`/);
    assert.match(mapper, /Do not use `task`, `Agent`, or any subagent dispatch mechanism/);
    assert.match(mapper, /Do not write `<WORKSPACE_PATH>\/registry\/services\.yaml`/);
    assert.match(mapper, /Do not write glossary files/);
  });

  test('uses analyzer instructions inline and supports deferred concerns', () => {
    assert.match(mapper, /jlu-codebase-analyzer-structural\.md/);
    assert.match(mapper, /jlu-codebase-analyzer-operational\.md/);
    assert.match(mapper, /Apply those analyzer instructions inline/);
    assert.match(mapper, /INTERVIEW_MODE=deferred/);
    assert.match(mapper, /User interview deferred by root batch mode/);
  });
});

describe('operational analyzer — batch interview modes', () => {
  const operational = read('agents/jlu-codebase-analyzer-operational.md');

  test('keeps interactive interview as normal default', () => {
    assert.match(operational, /mandatory for CONCERNS\.md in normal single-service mode/);
    assert.match(operational, /`INTERVIEW_MODE=interactive` or omitted: use AskUserQuestion/);
  });

  test('allows provided or deferred user context for root batch mode', () => {
    assert.match(operational, /`INTERVIEW_MODE=provided`/);
    assert.match(operational, /`INTERVIEW_MODE=deferred`/);
    assert.match(operational, /do not ask questions/);
    assert.match(operational, /User interview deferred by root batch mode/);
  });
});

describe('map-codebase runtime wrappers', () => {
  test('Claude skill exposes root args and permits explicit task dispatches', () => {
    const skill = read('skills/map-codebase/SKILL.md');
    assert.match(skill, /workspace root/);
    assert.match(skill, /argument-hint: "\[service-id \| --root \[root-path\] \| --all\]"/);
    assert.match(skill, /When the workflow explicitly says `task`, dispatch the named worker agent/);
    assert.doesNotMatch(skill, /Do NOT spawn a sub-agent/);
  });

  test('Codex skill mirror has the generated root argument hint', () => {
    const skill = read('.codex/skills/jlu-map-codebase/SKILL.md');
    assert.match(skill, /argument-hint: "\[service-id \| --root \[root-path\] \| --all\]"/);
  });
});
