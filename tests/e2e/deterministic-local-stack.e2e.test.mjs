import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const configPath = process.env.JLU_LOCAL_STACK_E2E_CONFIG;
const pluginRoot = resolve(process.env.JLU_INSTALLED_PLUGIN_ROOT || '.');
const runner = join(pluginRoot, 'bin', 'local-stack-e2e.mjs');
const passwordCanary = 'jlu-tier2-password-canary-8d119852';
const transactionalStages = ['plan', 'company', 'chatbot', 'user', 'access', 'operator', 'role', 'twoFactor', 'commit'];
const cleanupKinds = ['worktree', 'process', 'container', 'overlay', 'runtimeFile', 'keyringEntry', 'databaseRecord'];
const scenarioCache = new Map();

function execute(extraArgs = []) {
  return spawnSync(process.execPath, [
    runner,
    '--confirm-local-e2e',
    '--config',
    configPath,
    ...extraArgs,
  ], {
    encoding: 'utf8',
    env: { ...process.env, JLU_LOCAL_STACK_E2E_PASSWORD_CANARY: passwordCanary },
  });
}

function parseReport(result) {
  const output = result.status === 0 ? result.stdout : result.stderr;
  assert.ok(output.trim(), 'local-stack E2E must return a JSON report');
  return JSON.parse(output);
}

function loadScenario(extraArgs = []) {
  const cacheKey = JSON.stringify(extraArgs);
  if (scenarioCache.has(cacheKey)) return scenarioCache.get(cacheKey);
  let scenario;
  if (!configPath) {
    scenario = { skipReason: 'JLU_LOCAL_STACK_E2E_CONFIG is unset; no explicit live-stack configuration was supplied' };
  } else if (!existsSync(configPath)) {
    scenario = { skipReason: `live-stack configuration was not found at ${configPath}` };
  } else {
    const result = execute(extraArgs);
    const report = parseReport(result);
    scenario = report.code === 'E2E_PREFLIGHT_FAILED'
      ? { skipReason: `live-stack prerequisites unavailable: ${report.failures.map(({ name, reason }) => `${name}: ${reason}`).join('; ')}` }
      : { result, report, output: `${result.stdout}${result.stderr}` };
  }
  scenarioCache.set(cacheKey, scenario);
  return scenario;
}

function requireScenario(t, extraArgs = []) {
  const scenario = loadScenario(extraArgs);
  if (scenario.skipReason) {
    t.skip(scenario.skipReason);
    return null;
  }
  return scenario;
}

function passingScenario(t) {
  const scenario = requireScenario(t);
  if (!scenario) return null;
  assert.equal(scenario.result.status, 0, scenario.result.stderr);
  assert.equal(scenario.report.status, 'passed');
  return scenario;
}

function injectedFailureScenario(t) {
  const scenario = requireScenario(t, ['--inject-failure-after', 'SELF_SERVICE']);
  if (!scenario) return null;
  assert.equal(scenario.result.status, 1);
  assert.equal(scenario.report.status, 'failed');
  assert.match(scenario.report.message, /injected failure after SELF_SERVICE/);
  return scenario;
}

describe('installed deterministic local-stack E2E', () => {
  test('passes main and repeated task-aware starts with both supported onboarding plans', (t) => {
    const scenario = passingScenario(t);
    if (!scenario) return;

    assert.equal(existsSync(runner), true);
    assert.deepEqual(scenario.report.sourceModes, ['main', 'task-aware', 'task-aware']);
    assert.deepEqual(scenario.report.plans, ['ENTERPRISE', 'SELF_SERVICE']);
  });

  test('reaches every host and Docker topology direction over HTTP after changed overlays restart consumers', (t) => {
    const scenario = passingScenario(t);
    if (!scenario) return;
    const { reachability, overlayRestarts } = scenario.report.evidence;

    assert.deepEqual(reachability.map(({ direction }) => direction).sort(), [
      'docker-to-docker',
      'docker-to-host',
      'host-to-docker',
      'host-to-host',
    ]);
    assert.equal(reachability.every(({ status, consumerId, providerId }) => status === 200 && consumerId && providerId), true);
    assert.equal(overlayRestarts.length > 0, true);
    assert.equal(overlayRestarts.every(({ previousDigest, currentDigest, instanceBefore, instanceAfter, readinessStatus }) => (
      previousDigest
      && currentDigest
      && previousDigest !== currentDigest
      && instanceBefore
      && instanceAfter
      && instanceBefore !== instanceAfter
      && readinessStatus === 200
    )), true);
  });

  test('exercises first-run, incomplete-profile resume, and explicit reconfiguration through the interactive adapter', (t) => {
    const scenario = passingScenario(t);
    if (!scenario) return;
    const { onboarding } = scenario.report.evidence;

    assert.deepEqual(onboarding.firstRun, {
      trigger: 'missing-profile',
      companyId: 135,
      promptedFields: ['companyMode', 'userName', 'email', 'password'],
      profileComplete: true,
    });
    assert.deepEqual(onboarding.resume, {
      trigger: 'incomplete-profile',
      promptedFields: ['email', 'password'],
      preservedFields: ['company', 'userName'],
      profileComplete: true,
    });
    assert.deepEqual(onboarding.reconfigure, {
      trigger: 'reconfigure',
      promptedFields: ['companyMode', 'companyName', 'plan', 'userName', 'email', 'password'],
      replacedNonSecretValues: true,
      replacedKeyringValue: true,
      profileComplete: true,
    });
  });

  test('interactive onboarding rejects every invalid field before keyring or database mutation', (t) => {
    const scenario = passingScenario(t);
    if (!scenario) return;
    const rejections = scenario.report.evidence.onboarding.rejections;

    assert.deepEqual(rejections.map(({ field, value }) => [field, value]), [
      ['companyMode', 'shared'],
      ['existingCompanyId', 0],
      ['companyName', ''],
      ['plan', 'POCKET'],
      ['userName', ''],
      ['email', 'not-an-email'],
      ['password', ''],
    ]);
    assert.equal(rejections.every(({ keyringMutationCount, databaseMutationCount, diagnostic }) => (
      keyringMutationCount === 0 && databaseMutationCount === 0 && diagnostic
    )), true);
  });

  test('fresh database reads prove enum installation and one complete graph per plan after replay', (t) => {
    const scenario = passingScenario(t);
    if (!scenario) return;
    const { database } = scenario.report.evidence;

    assert.equal(database.enumValues.includes('SELF_SERVICE'), true);
    assert.deepEqual(database.freshReads.map(({ plan }) => plan), ['ENTERPRISE', 'SELF_SERVICE']);
    for (const read of database.freshReads) {
      assert.deepEqual(read.counts, {
        companies: 1,
        chatbots: 1,
        users: 1,
        accesses: 1,
        operators: 1,
        roles: 1,
        passwordRecords: 1,
        twoFactorChallenges: 0,
      });
      assert.equal(read.companyPlan, read.plan);
      assert.equal(read.referencesComplete, true);
    }
    assert.equal(database.replayed, true);
  });

  test('a forced failure at every transaction stage leaves no partial graph and preserves committed records', (t) => {
    const scenario = passingScenario(t);
    if (!scenario) return;
    const rollbacks = scenario.report.evidence.database.transactionRollbacks;

    assert.deepEqual(rollbacks.map(({ stage }) => stage), transactionalStages);
    assert.equal(rollbacks.every(({ partialRecordCount, committedGraphUnchanged }) => (
      partialRecordCount === 0 && committedGraphUnchanged === true
    )), true);
  });

  test('real keyring and bcrypt boundaries preserve task isolation and the last usable password on replacement failure', (t) => {
    const scenario = passingScenario(t);
    if (!scenario) return;
    const { credentials } = scenario.report.evidence;

    assert.equal(credentials.bcryptAuthenticatedPlans.length, 2);
    assert.deepEqual(credentials.bcryptAuthenticatedPlans.sort(), ['ENTERPRISE', 'SELF_SERVICE']);
    assert.equal(credentials.sameEmailProfiles.taskAIdentity !== credentials.sameEmailProfiles.taskBIdentity, true);
    assert.equal(credentials.sameEmailProfiles.taskAAuthenticated, true);
    assert.equal(credentials.sameEmailProfiles.taskBAuthenticated, true);
    assert.deepEqual(credentials.failedReplacement, {
      previousDatabasePasswordAuthenticated: true,
      previousKeyringPasswordAuthenticated: true,
      replacementPasswordAuthenticated: false,
    });
  });

  test('genuine dashboard cookies persist as 0600, authenticate API and UI, reuse once, and refresh exactly once when expired', (t) => {
    const scenario = passingScenario(t);
    if (!scenario) return;
    const { authentication } = scenario.report.evidence;

    assert.equal(authentication.cookie.name, 'jelou_auth');
    assert.equal(authentication.cookie.source, 'dashboard');
    assert.equal(authentication.cookie.fileMode, '0600');
    assert.equal(authentication.apiStatus, 200);
    assert.equal(new URL(authentication.protectedUrl).pathname.startsWith('/login'), false);
    assert.deepEqual(authentication.validCookieReuse, { dashboardLoginCount: 0, keyringReadCount: 0, apiStatus: 200 });
    assert.deepEqual(authentication.expiredCookieRefresh, { dashboardLoginCount: 1, keyringReadCount: 1, apiStatus: 200 });
  });

  test('invalid credentials and missing dashboard cookies never inject stale or synthetic browser credentials', (t) => {
    const scenario = passingScenario(t);
    if (!scenario) return;
    const rejections = scenario.report.evidence.authentication.rejections;

    assert.deepEqual(rejections.map(({ reason }) => reason), ['invalid-credentials', 'missing-jelou-auth-cookie']);
    assert.equal(rejections.every(({ browserCookieInjected, staleCookieReused, finalStatus }) => (
      browserCookieInjected === false && staleCookieReused === false && finalStatus === 'failed'
    )), true);
  });

  test('live diagnostics exercise password and cookie redaction across every observable output channel', (t) => {
    const scenario = passingScenario(t);
    if (!scenario) return;
    const { redaction } = scenario.report.evidence;

    assert.equal(redaction.passwordCanaryExercised, true);
    assert.deepEqual(redaction.secretKinds.sort(), ['cookie', 'password']);
    assert.deepEqual(redaction.channels.sort(), [
      'commandLine',
      'daemonEvents',
      'snapshots',
      'stderr',
      'stdout',
      'testReports',
      'tmuxPane',
      'traces',
    ]);
    assert.doesNotMatch(scenario.output, new RegExp(passwordCanary));
  });

  test('a successful run leaves zero owned worktrees, processes, containers, overlays, runtime files, keyring entries, or database records', (t) => {
    const scenario = passingScenario(t);
    if (!scenario) return;
    const { inventory } = scenario.report.cleanup;

    assert.deepEqual(scenario.report.cleanup.refused, []);
    assert.deepEqual(Object.keys(inventory).sort(), [...cleanupKinds].sort());
    assert.equal(cleanupKinds.every((kind) => inventory[kind].created > 0 && inventory[kind].remaining === 0), true);
  });

  test('an injected failure removes owned mixed resources while preserving reused services and pre-existing records', (t) => {
    const scenario = injectedFailureScenario(t);
    if (!scenario) return;
    const { cleanup } = scenario.report;

    assert.deepEqual(cleanup.refused, []);
    assert.deepEqual(Object.keys(cleanup.inventory).sort(), [...cleanupKinds].sort());
    assert.equal(cleanupKinds.every((kind) => cleanup.inventory[kind].created > 0 && cleanup.inventory[kind].remaining === 0), true);
    assert.equal(cleanup.preserved.some(({ kind, reason }) => kind === 'process' && reason === 'reused'), true);
    assert.equal(cleanup.preserved.some(({ kind, reason }) => kind === 'databaseRecord' && reason === 'pre-existing'), true);
    assert.doesNotMatch(scenario.output, new RegExp(passwordCanary));
  });
});
