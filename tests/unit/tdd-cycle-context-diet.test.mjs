import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
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

describe('jlu-tdd-cycle — the four codebase docs left the mandatory reading list', () => {
  test('Context You Must Read names none of them', () => {
    const body = contextSection();
    for (const doc of ['CONVENTIONS.md', 'STACK.md', 'STRUCTURE.md', 'ARCHITECTURE.md']) {
      assert.doesNotMatch(
        body,
        new RegExp(`^\\s*\\d+\\.\\s+\\*\\*${doc.replace('.', '\\.')}\\*\\*`, 'm'),
        `${doc} is still a numbered mandatory read in ${AGENT_PATH}`,
      );
    }
  });

  test('the excerpt is described as arriving through the prompt', () => {
    const body = contextSection();
    assert.match(body, /injects them into your prompt/);
    assert.match(body, /## Module Organization/);
    assert.match(body, /## File Naming Conventions/);
  });
});

describe('jlu-tdd-cycle — STACK.md and ARCHITECTURE.md are hard-prohibited', () => {
  test('Rules forbids reading them outright, with no on-demand escape hatch', () => {
    const rules = rulesSection();
    assert.match(rules, /Never read `STACK\.md` or `ARCHITECTURE\.md`/);
    assert.match(rules, /Deviations from Expected Approach/);
    assert.doesNotMatch(rules, /STACK\.md[^\n]*(on demand|only if you need|if needed)/i);
  });

  test('Before You Submit carries the checkbox', () => {
    assert.match(checklistSection(), /- \[ \] I did not read STACK\.md or ARCHITECTURE\.md/);
  });
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

describe('execute-task — the codebase docs are hoisted to a per-task cache', () => {
  test('Step 6.2 populates SERVICE_DOC_CACHE through the projection bin', () => {
    const setup = section(workflow, '2. **Per-service setup', '3. Update TASKS.md with the per-service baselines');
    assert.match(setup, /SERVICE_DOC_CACHE\[service-id\]/);
    assert.match(setup, /bin\/extract-doc-sections\.mjs/);
    assert.match(setup, /--section="Module Organization"/);
    assert.match(setup, /--section="File Naming Conventions"/);
  });

  test('Step 6.2 bounds the cached payload and degrades to paths past the bound', () => {
    const setup = section(workflow, '2. **Per-service setup', '3. Update TASKS.md with the per-service baselines');
    assert.match(setup, /8k tokens/);
    assert.match(setup, /cache the \*\*paths\*\* instead of the contents/);
    assert.match(setup, /WARN: SERVICE_DOC_CACHE/);
  });

  test('Step 6.2 stores the cache alongside the source path', () => {
    assert.match(workflow, /\*\*Store\*\* \(per-service maps\): `SERVICE_SOURCE_PATH`, `SERVICE_DOC_CACHE`\./);
  });

  test('Step 7c only looks the cache up', () => {
    const s7c = section(workflow, '### 7c. Open the phase', '### 7d. TDD Cycle');
    assert.match(s7c, /SERVICE_DOC_CACHE\[service-id\]/);
    assert.match(s7c, /never recomputes or re-reads/);
    assert.doesNotMatch(s7c, /extract-doc-sections/);
  });

  test('Step 7c injects contents and never names STACK.md or ARCHITECTURE.md', () => {
    const s7c = section(workflow, '### 7c. Open the phase', '### 7d. TDD Cycle');
    assert.match(s7c, /--docs-file/);
    assert.match(s7c, /SERVICE_DOC_CACHE\[service-id\]/);
    assert.match(s7c, /inlined as contents, never as paths/);
    assert.match(s7c, /no phase ever re-reads/);
    assert.doesNotMatch(s7c, /STACK/);
    assert.doesNotMatch(s7c, /\{CONVENTIONS,STACK,STRUCTURE,ARCHITECTURE\}/);
  });

  test('the dispatch builder suppresses the CODEBASE_DOCS path when docs are inlined', () => {
    const s7c = section(workflow, '### 7c. Open the phase', '### 7d. TDD Cycle');
    assert.match(s7c, /suppresses the `CODEBASE_DOCS` path row/);
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
