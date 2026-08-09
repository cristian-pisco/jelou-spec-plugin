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
    assert.match(workflow, /boot-stack\.mjs[^\n]*--run-id \{runId\}/);
    assert.match(workflow, /recordOwnedMutation/);
    assert.match(workflow, /appendLifecycleEvent[\s\S]*eventsLogPath/);
  });

  test('the boot loop is a shipped executable, never prose the orchestrator reimplements', () => {
    const boot = workflow.slice(workflow.indexOf('### Step B —'), workflow.indexOf('### Step B1'));

    assert.match(boot, /bin\/boot-stack\.mjs/);
    assert.match(boot, /Do NOT reimplement the boot loop/);
    assert.match(boot, /Never use `verifySharedReuse` to boot/);
    assert.doesNotMatch(boot, /obtain its descriptor with `planEntryToCommands`/);
  });

  test('compose-project teardown records come from what the runner created, not from the plan', () => {
    const record = workflow.slice(workflow.indexOf('### Step C1'), workflow.indexOf('### Precondition'));

    assert.match(record, /bootMutationsJson/);
    assert.doesNotMatch(record, /policy\s*!==\s*'task-isolated'\)\s*continue/);
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

describe('start-dev boot frictions', () => {
  test('an explicit slug argument overrides every cwd heuristic', () => {
    assert.match(workflow, /taskSlugArgument/);
    assert.match(workflow, /resolveTaskSlug\(\{[^}]*override: process\.argv\[3\] \|\| undefined/);
    assert.equal(workflow.split('resolveTaskSlug({').length - 1, workflow.split('override: process.argv[3]').length - 1);
  });

  test('the router explains that an empty jlu-services.json is not a tmux workspace', () => {
    const step = workflow.slice(workflow.indexOf('## Step 0'), workflow.indexOf('## Step 1'));

    assert.match(step, /registers \*\*zero\*\* services routes to `jelou-stack`/);
  });

  test('an orphaned previous run is reconciled before the plan is built', () => {
    const reconcile = workflow.indexOf('### Step A0');
    const firstWrite = workflow.indexOf('### Step B0');

    assert.ok(reconcile > -1 && reconcile < firstWrite);
    assert.match(workflow.slice(workflow.indexOf('### Step A —'), reconcile), /Then run Step A0, and only then build and validate the plan/);
    assert.match(workflow.slice(reconcile, firstWrite), /has an unrelated live owner/);
    const step = workflow.slice(reconcile, firstWrite);
    assert.match(step, /reconcile-stack-run\.mjs/);
    assert.match(step, /"status":"reconciled"/);
    assert.match(step, /"status":"active"/);
    assert.match(step, /jlu:stop-dev/);
  });

  test('the browser handoff is confirmed against the app session marker, not the url alone', () => {
    const step = workflow.slice(workflow.indexOf('### Step I.5'), workflow.indexOf('### Notes — frontend + auth'));

    assert.match(step, /markerScript/);
    assert.match(step, /probeScript/);
    assert.match(step, /handoffSucceeded\(\{ finalUrl: result\.url, sessionMarkers: plan\.sessionMarkers, observedStorage: result\.storage \}\)/);
    assert.match(step, /httpOnly/);
    assert.match(step, /never report the stack green on the strength of\n?Step H, or of the final URL alone/);
  });

  test('the port report distinguishes a published port from one that actually answers', () => {
    const step = workflow.slice(workflow.indexOf('### Step C —'), workflow.indexOf('### Step C1'));

    assert.match(step, /probeHostPort/);
    assert.match(step, /corrected/);
    assert.match(step, /fix dev\.ports in registry\/services\.yaml/);
  });

  test('a missing local_database is named as its own onboarding failure', () => {
    const step = workflow.slice(workflow.indexOf('### Step F0'), workflow.indexOf('### Step G'));

    assert.match(step, /local_database/);
    assert.match(step, /proveLocalDatabaseTarget/);
  });
});
