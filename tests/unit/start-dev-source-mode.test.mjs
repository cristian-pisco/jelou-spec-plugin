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

  test('threads one run identity through lifecycle events execution descriptors and owned mutation journaling', () => {
    assert.match(workflow, /randomUUID/);
    assert.match(workflow, /runIdentity\s*=\s*\{\s*workspaceId[\s\S]*taskSlug:\s*slug[\s\S]*runId/);
    assert.match(workflow, /planEntryToCommands\([^)]*\{\s*runIdentity\s*\}/);
    assert.match(workflow, /recordOwnedMutation/);
    assert.match(workflow, /appendLifecycleEvent[\s\S]*eventsLogPath/);
    assert.match(workflow, /policy\s*!==\s*'task-isolated'\)\s*continue/);
  });

  test('runs keyring-backed local onboarding before login and journals only returned owned resources', () => {
    const onboarding = workflow.indexOf('### Step F0');
    const login = workflow.indexOf('### Step G');
    assert.ok(onboarding > -1 && onboarding < login);
    const step = workflow.slice(onboarding, login);
    assert.match(step, /local-auth-onboarding\.mjs/);
    assert.match(step, /--adapter-module/);
    assert.match(step, /stdin/i);
    assert.match(step, /--reconfigure/);
    assert.match(step, /setLocalAuthProfile/);
    assert.match(step, /cleanupResources/);
    assert.doesNotMatch(step, /--password|E2E_USER_PASSWORD|PASSWORD=/);
  });

  test('decides the provisioning adapter from the normalized registry instead of restating the condition', () => {
    const onboarding = workflow.indexOf('### Step F0');
    const step = workflow.slice(onboarding, workflow.indexOf('### Step G'));

    assert.match(step, /resolveProvisioningAdapter/);
    assert.match(step, /normalized/i);
    assert.match(step, /never the raw `services\.yaml`/);
    assert.match(step, /`ok: false` → \*\*stop\*\*/);
    assert.match(step, /never skip into credential lookup/);
    assert.match(step, /do NOT tell the user to register an adapter that is already/);
  });

  test('establishes the protected jelou-apps session through task cookie state and the keyring profile', () => {
    const login = workflow.indexOf('### Step G');
    const handoff = workflow.indexOf('### Step I.5');
    const step = workflow.slice(login, handoff);

    assert.match(step, /establishAuthenticatedSession/);
    assert.match(step, /createOsKeyring/);
    assert.match(step, /localAuthProfile/);
    assert.match(step, /createBrowserContext/);
    assert.match(step, /protectedPath/);
    assert.match(step, /appendLifecycleEvent/);
    assert.match(step, /exactly one keyring-backed login/i);
    assert.doesNotMatch(step, /E2E_PASSWORD|E2E_USER_PASSWORD|JLU_INJECT_COOKIE|renderInjectPage|credentials\.envFile/);
  });

  test('the session handoff transfers a verified cookie and can never mint one', () => {
    const handoff = workflow.indexOf('### Step I.5');
    const notes = workflow.indexOf('### Notes — frontend + auth');
    assert.ok(handoff > 0, 'Step I.5 must exist — without it the run ends with no session in any browser');
    const step = workflow.slice(handoff, notes);

    assert.match(step, /planBrowserHandoff/);
    assert.match(step, /readAuthCookie/);
    assert.match(step, /handoffSucceeded/);
    assert.match(step, /mcp__chrome-devtools__new_page/);
    assert.doesNotMatch(step, /E2E_PASSWORD|E2E_USER_PASSWORD|credentials\.envFile/);
  });

  test('the handoff entry URL is localhost, never the loopback literal', () => {
    const handoff = workflow.indexOf('### Step I.5');
    const notes = workflow.indexOf('### Notes — frontend + auth');
    const step = workflow.slice(handoff, notes);
    assert.match(step, /not `127\.0\.0\.1`/);
  });

  test('the browser boundary still bans the injector for establishing a session', () => {
    const notes = workflow.slice(workflow.indexOf('### Notes — frontend + auth'));
    assert.match(notes, /Do not substitute an HTML cookie injector/);
    assert.match(notes, /establishing or verifying the session/);
  });
});
