import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const AGENT_PATH = 'agents/jlu-tdd-cycle.md';
const agent = read(AGENT_PATH);
const workflow = read('jelou/workflows/execute-task.md');

const section = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  assert.ok(start !== -1, `marker not found: ${startMarker}`);
  const end = endMarker ? text.indexOf(endMarker, start + startMarker.length) : text.length;
  assert.ok(end !== -1, `end marker not found: ${endMarker}`);
  return text.slice(start, end);
};

const contextSection = () => section(agent, '## Context You Must Read', '## Test Tier');
const rulesSection = () => section(agent, '## Rules', '## Verification Invariants');
const checklistSection = () => section(agent, '## Before You Submit', '## Rules');

const DOCS = ['ARCHITECTURE.md', 'STACK.md', 'STRUCTURE.md', 'CONVENTIONS.md', 'INTEGRATIONS.md', 'CONCERNS.md'];

describe('jlu-tdd-cycle — no generated codebase doc is on the reading list', () => {
  test('Context You Must Read names none of them as a numbered mandatory read', () => {
    const body = contextSection();
    for (const doc of DOCS) {
      assert.doesNotMatch(
        body,
        new RegExp(`^\\s*\\d+\\.\\s+\\*\\*${doc.replace('.', '\\.')}\\*\\*`, 'm'),
        `${doc} is still a numbered mandatory read in ${AGENT_PATH}`,
      );
    }
  });

  test('nothing claims the orchestrator resolves or injects the docs', () => {
    const body = contextSection();
    assert.doesNotMatch(body, /orchestrator resolves them/);
    assert.doesNotMatch(body, /Use the injected text/);
    assert.match(body, /nothing injects them into your prompt/);
  });
});

describe('jlu-tdd-cycle — every generated codebase doc is hard-prohibited', () => {
  test('Rules forbids reading them outright, with no on-demand escape hatch', () => {
    const rules = rulesSection();
    assert.match(rules, /Never read a generated codebase document/);
    // The prohibition names the DIRECTORY, never the documents. Naming them would put
    // the very filenames we want the agent to never think about back into its context.
    assert.match(rules, /`\.spec-workspace\/services\/\*\/codebase\/`/);
    for (const doc of DOCS) {
      assert.ok(!rules.includes(doc), `${doc} is named in the prohibition`);
    }
    assert.match(rules, /Deviations from Expected Approach/);
  });

  test('Before You Submit carries the checkbox', () => {
    assert.match(checklistSection(), /- \[ \] I did not read any generated codebase document/);
  });
});

describe('no agent or workflow prompt names a generated codebase doc', () => {
  // Only the producers may name them: the analyzers, the mapper, and the workflow that
  // dispatches them. Every other prompt refers to the `codebase/` directory instead.
  const PRODUCERS = new Set([
    'agents/jlu-codebase-analyzer-operational.md',
    'agents/jlu-codebase-analyzer-structural.md',
    'agents/jlu-codebase-mapper.md',
    'jelou/workflows/map-codebase.md',
  ]);

  const prompts = [
    ...readdirSync(join(ROOT, 'agents')).map((f) => `agents/${f}`),
    ...readdirSync(join(ROOT, 'jelou', 'workflows')).map((f) => `jelou/workflows/${f}`),
    ...readdirSync(join(ROOT, 'jelou', 'workflows-opencode')).map((f) => `jelou/workflows-opencode/${f}`),
    ...readdirSync(join(ROOT, 'jelou', 'references')).map((f) => `jelou/references/${f}`),
  ].filter((rel) => rel.endsWith('.md') && !PRODUCERS.has(rel));

  for (const rel of prompts) {
    test(`${rel} names none of them`, () => {
      const body = read(rel);
      for (const doc of DOCS) {
        assert.ok(!body.includes(doc), `${doc} still appears in ${rel}`);
      }
    });
  }
});

describe('jlu-tdd-cycle — project-wide typecheckers are prohibited', () => {
  test('Rules forbids tsc --noEmit, mypy and go vet with the reason inline', () => {
    const rules = rulesSection();
    assert.match(rules, /Never run a project-wide typechecker/);
    assert.match(rules, /tsc --noEmit/);
    assert.match(rules, /mypy/);
    assert.match(rules, /go vet/);
    assert.match(rules, /ts-jest/);
    assert.match(rules, /jlu-build-validator/);
    assert.match(rules, /8a\.5/);
  });

  test('Before You Submit carries the checkbox', () => {
    assert.match(checklistSection(), /- \[ \] I did not run a project-wide typechecker/);
  });

  test('the prohibition is scoped to this agent — jlu-ui-e2e-writer still prescribes tsc --noEmit', () => {
    assert.match(read('agents/jlu-ui-e2e-writer.md'), /tsc --noEmit/);
  });
});

describe('execute-task — no codebase doc reaches a phase dispatch', () => {
  test('Step 6.2 emits no doc cache at all', () => {
    const setup = section(workflow, '2. **Per-service setup', '3. Update TASKS.md with the per-service baselines');
    assert.doesNotMatch(setup, /SERVICE_DOC_CACHE/);
    assert.doesNotMatch(setup, /extract-doc-sections/);
    assert.doesNotMatch(setup, /docs_file|docs_mode|docs_chars/);
  });

  test('Step 6.2 stores only the source path', () => {
    assert.match(workflow, /\*\*Store\*\* \(per-service map\): `SERVICE_SOURCE_PATH`\./);
    assert.doesNotMatch(workflow, /SERVICE_DOC_CACHE/);
  });

  test('Step 7c passes no docs and states the prohibition', () => {
    const s7c = section(workflow, '### 7c. Open the phase', '### 7d. TDD Cycle');
    assert.doesNotMatch(s7c, /--docs-file/);
    assert.doesNotMatch(s7c, /CODEBASE_DOCS/);
    assert.match(s7c, /Nothing from `<WORKSPACE_PATH>\/services\/<service-id>\/codebase\/` is ever passed/);
  });

  test('the dispatch builder has no docs plumbing left', () => {
    const builder = read('bin/build-dispatch-prompt.mjs');
    assert.doesNotMatch(builder, /docs-file|docsBody|CODEBASE_DOCS|codebaseDocs/);
  });

  test('the whole workflow names no generated codebase doc', () => {
    for (const doc of DOCS) {
      assert.ok(!workflow.includes(doc), `${doc} still appears in execute-task.md`);
    }
  });

  test('Step 7d restates none of the context Step 7c already emitted', () => {
    const s7d = section(workflow, '### 7d. TDD Cycle', '### 7e —');
    assert.match(s7d, /Nothing above is restated here or in the dispatch/);
    assert.doesNotMatch(s7d, /--docs-file/);
  });
});

describe('execute-task — the wave/level contradiction is resolved', () => {
  test('an emitted wave never holds two phases of the same service', () => {
    const planning = section(workflow, 'Each emitted wave lists the phases', '#### Concurrency cap');
    assert.match(planning, /a level is not a wave/);
    assert.match(planning, /at most one phase per service per chunk, unconditionally/i);
    assert.match(planning, /never contains two phases of the same service/);
  });

  test('single-service tasks are called out as structurally serial', () => {
    const planning = section(workflow, 'Each emitted wave lists the phases', '#### Concurrency cap');
    assert.match(planning, /single-service task never gets phase-level parallelism/);
    assert.match(planning, /structurally impossible/);
  });

  test('no site still claims a wave may hold several phases of the same service', () => {
    assert.doesNotMatch(workflow, /a wave can now contain more than one phase from the \*same\* service/);
  });
});

describe('the doc-cache surfaces are gone from every remaining reference', () => {
  test('the execute-task artifact table no longer lists a service doc cache', () => {
    const table = section(workflow, '## Artifact Paths', '## Step N — Close workflow span');
    assert.doesNotMatch(table, /service-docs\.md/);
    assert.doesNotMatch(table, /Service doc cache/);
  });

  test('bin/extract-doc-sections.mjs is deleted and no installer still copies it', () => {
    assert.ok(!existsSync(join(ROOT, 'bin', 'extract-doc-sections.mjs')), 'the projection bin is still on disk');
    for (const installer of ['bin/install-codex.sh', 'bin/install-opencode.sh']) {
      assert.doesNotMatch(read(installer), /extract-doc-sections/, `${installer} still copies the deleted bin`);
    }
  });

  test('no shipped script imports the deleted projection module or its flags', () => {
    for (const rel of ['bin/task-setup.mjs', 'bin/build-dispatch-prompt.mjs', 'bin/phase-open.mjs', 'bin/phase-close.mjs']) {
      assert.doesNotMatch(read(rel), /extract-doc-sections|extractSections/, `${rel} still imports the deleted module`);
    }
    assert.doesNotMatch(read('bin/task-setup.mjs'), /docs-budget|buildDocsPayload|service-docs\.md/);
  });

  test('phase-open and phase-close no longer plumb docs or conventions through', () => {
    const open = read('bin/phase-open.mjs');
    assert.doesNotMatch(open, /docs-file/);
    const close = read('bin/phase-close.mjs');
    assert.doesNotMatch(close, /conventions|FORMAT_CONVENTIONS/i);
  });

  test('manual-skills.md no longer advertises the removed council --services flag', () => {
    const manual = read('manual-skills.md');
    const usage = section(manual, '### `/jlu-council`', '## Plugin observability');
    assert.doesNotMatch(usage, /--services/);
  });
});
