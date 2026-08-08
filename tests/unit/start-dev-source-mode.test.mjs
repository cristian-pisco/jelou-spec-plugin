import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const workflow = readFileSync(join(import.meta.dirname, '..', '..', 'jelou', 'workflows', 'start-dev.md'), 'utf8');

describe('start-dev source selection', () => {
  test('every interactive invocation offers the source choices allowed by active-task state', () => {
    assert.match(workflow, /sourceModeChoices/);
    assert.match(workflow, /Ask the user[\s\S]{0,500}`main`[\s\S]{0,500}`task-aware`/i);
    assert.match(workflow, /No active task is available/);
  });

  test('passes the normalized selection through the boot-plan CLI option', () => {
    assert.match(
      workflow,
      /build-boot-plan\.mjs --workspace \{root\} --slug \{slug\} --source-mode \{sourceMode\}/,
    );
  });

  test('reports every selected source path and commit before runtime mutation', () => {
    const report = workflow.indexOf('Report every selected source before any runtime mutation');
    const firstMutation = workflow.indexOf('### Step B0');
    assert.ok(report > -1 && report < firstMutation);
    assert.match(workflow.slice(report, firstMutation), /serviceId.*sourcePath.*commit/s);
  });

  test('delegates task source resolution to the shared boot-plan contract', () => {
    assert.doesNotMatch(workflow, /Build `worktreePaths`/);
    assert.match(workflow, /source descriptor/);
  });
});
