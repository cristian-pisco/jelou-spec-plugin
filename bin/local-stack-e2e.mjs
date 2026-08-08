#!/usr/bin/env node
import { argv } from 'node:process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_PREFLIGHTS = [
  'docker',
  'repositories',
  'keyring',
  'localDatabase',
  'browser',
  'provisioningAdapter',
  'dashboard',
  'api',
  'ui',
];

const TOPOLOGY_DIRECTIONS = new Set([
  'host-to-host',
  'host-to-docker',
  'docker-to-host',
  'docker-to-docker',
]);

function assertModeResult(result, sourceMode) {
  if (result.sourceMode !== sourceMode) throw new Error(`expected ${sourceMode} mode result`);
  if (sourceMode === 'main' && Object.values(result.sources || {}).some((source) => source !== 'main')) {
    throw new Error('main mode selected a task source');
  }
  if (sourceMode === 'task-aware' && !Object.values(result.sources || {}).includes('task')) {
    throw new Error('task-aware mode selected no task sources');
  }
  const directions = new Set(result.topologyDirections || []);
  for (const direction of TOPOLOGY_DIRECTIONS) {
    if (!directions.has(direction)) throw new Error(`topology direction was not proven: ${direction}`);
  }
  if ((result.overlayRestartedConsumers || []).length === 0) {
    throw new Error('environment overlay change did not restart a consumer');
  }
}

function assertProvisioning(result, plan) {
  if (result.plan !== plan || result.company?.plan !== plan) throw new Error(`${plan} provisioning changed plan`);
  if (!result.user?.active || !result.user?.emailVerified) throw new Error(`${plan} user is not active and verified`);
  const relations = result.relations || {};
  if (relations.chatbotCompanyId !== result.company.id
    || relations.accessCompanyId !== result.company.id
    || relations.accessUserId !== result.user.id
    || relations.operatorUserId !== result.user.id
    || relations.roleUserId !== result.user.id) {
    throw new Error(`${plan} graph has incomplete cross-field relations`);
  }
  if (result.cookie?.name !== 'jelou_auth' || result.cookie?.source !== 'dashboard') {
    throw new Error(`${plan} authentication did not return a genuine dashboard jelou_auth cookie`);
  }
  if (!Array.isArray(result.apiStatuses) || result.apiStatuses.length === 0 || result.apiStatuses.some((status) => status !== 200)) {
    throw new Error(`${plan} protected API verification failed`);
  }
  if (!result.protectedUrl || new URL(result.protectedUrl).pathname.startsWith('/login')) {
    throw new Error(`${plan} protected browser route redirected to login`);
  }
}

export function createE2eIdentity({ workspaceId = 'local-stack-e2e' } = {}) {
  const runId = randomUUID();
  const suffix = runId.replaceAll('-', '').slice(0, 16);
  const taskSlug = `jlu-e2e-${suffix}`;
  const enterprisePassword = randomUUID();
  const selfServicePassword = randomUUID();
  return {
    marker: { workspaceId, taskSlug, runId },
    companies: {
      ENTERPRISE: { name: `Jelou E2E Enterprise ${suffix}` },
      SELF_SERVICE: { name: `Jelou E2E Self Service ${suffix}` },
    },
    users: {
      ENTERPRISE: { name: 'Jelou E2E Enterprise', email: `jlu-e2e-enterprise-${suffix}@example.test`, password: enterprisePassword },
      SELF_SERVICE: { name: 'Jelou E2E Self Service', email: `jlu-e2e-self-service-${suffix}@example.test`, password: selfServicePassword },
    },
  };
}

function sameMarker(left, right) {
  return left?.workspaceId === right?.workspaceId
    && left?.taskSlug === right?.taskSlug
    && left?.runId === right?.runId;
}

export async function cleanupOwnedResources(resources, marker, cleanupResource) {
  const refused = [];
  let removed = 0;
  for (const resource of [...resources].reverse()) {
    if (!resource.owner) {
      refused.push({ kind: resource.kind, id: resource.id, reason: 'ownership-marker-missing' });
      continue;
    }
    if (!sameMarker(resource.owner, marker)) {
      refused.push({ kind: resource.kind, id: resource.id, reason: 'ownership-marker-mismatch' });
      continue;
    }
    try {
      await cleanupResource(resource);
      removed += 1;
    } catch {
      refused.push({ kind: resource.kind, id: resource.id, reason: 'cleanup-failed' });
    }
  }
  return { removed, refused };
}

export async function runDeterministicFullStackE2e(options, adapter) {
  const preflight = await adapter.inspectPreflight(options);
  const failures = REQUIRED_PREFLIGHTS
    .filter((name) => preflight[name]?.ok !== true)
    .map((name) => ({ name, reason: preflight[name]?.reason || 'missing proof' }));
  if (failures.length > 0) {
    const error = new Error(`local-stack E2E preflight failed: ${failures.map(({ name, reason }) => `${name}: ${reason}`).join('; ')}`);
    error.code = 'E2E_PREFLIGHT_FAILED';
    error.failures = failures;
    throw error;
  }
  const identity = adapter.createIdentity ? adapter.createIdentity() : createE2eIdentity(options);
  const resources = [];
  const registerResource = (resource) => resources.push(resource);
  let report;
  let failure;
  try {
    const fixture = await adapter.createFixture({ options, identity, registerResource });
    resources.push(...(fixture.resources || []));
    const main = await adapter.runMode({ sourceMode: 'main', attempt: 1, fixture, identity, registerResource });
    resources.push(...(main.resources || []));
    assertModeResult(main, 'main');
    const taskAware = await adapter.runMode({ sourceMode: 'task-aware', attempt: 1, fixture, identity, registerResource });
    resources.push(...(taskAware.resources || []));
    assertModeResult(taskAware, 'task-aware');
    const taskAwareRepeated = await adapter.runMode({ sourceMode: 'task-aware', attempt: 2, fixture, identity, registerResource });
    resources.push(...(taskAwareRepeated.resources || []));
    assertModeResult(taskAwareRepeated, 'task-aware');
    if (JSON.stringify(taskAware.ports) !== JSON.stringify(taskAwareRepeated.ports)) {
      throw new Error('task-aware ports changed between starts');
    }
    const provisioning = [];
    for (const plan of ['ENTERPRISE', 'SELF_SERVICE']) {
      const result = await adapter.provisionAndVerify({
        plan,
        company: identity.companies[plan],
        user: identity.users[plan],
        fixture,
        mode: taskAwareRepeated,
        identity,
        registerResource,
      });
      resources.push(...(result.resources || []));
      assertProvisioning(result, plan);
      provisioning.push(result);
      if (options.injectFailureAfter === plan) throw new Error(`injected failure after ${plan}`);
    }
    report = { status: 'passed', preflight, marker: identity.marker, fixture, modes: [main, taskAware, taskAwareRepeated], provisioning };
  } catch (error) {
    failure = error;
  }
  const cleanup = await cleanupOwnedResources(resources, identity.marker, adapter.cleanupResource);
  if (failure) {
    failure.cleanup = cleanup;
    throw failure;
  }
  const ownedCleanupFailures = cleanup.refused.filter(({ reason }) => reason === 'cleanup-failed');
  if (ownedCleanupFailures.length > 0) {
    const error = new Error('local-stack E2E left owned resources after cleanup');
    error.code = 'E2E_CLEANUP_FAILED';
    error.cleanup = cleanup;
    throw error;
  }
  return { ...report, cleanup };
}

function parseArgs(args) {
  const out = { confirmed: false, configPath: null, injectFailureAfter: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--confirm-local-e2e') out.confirmed = true;
    else if (arg === '--config') out.configPath = args[index += 1];
    else if (arg === '--inject-failure-after') out.injectFailureAfter = args[index += 1];
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return out;
}

async function main() {
  let args;
  try {
    args = parseArgs(argv.slice(2));
  } catch (error) {
    process.stderr.write(`local-stack-e2e: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  if (!args.confirmed) {
    process.stderr.write('local-stack-e2e: --confirm-local-e2e is required before any adapter or stack access\n');
    process.exitCode = 2;
    return;
  }
  if (!args.configPath) {
    process.stderr.write('local-stack-e2e: --config <path> is required\n');
    process.exitCode = 2;
    return;
  }
  try {
    const configPath = resolve(args.configPath);
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!config.adapterPath) throw new Error('config.adapterPath is required');
    const adapterModule = await import(pathToFileURL(resolve(config.adapterPath)).href);
    if (typeof adapterModule.createAdapter !== 'function') throw new Error('E2E adapter must export createAdapter(config)');
    const adapter = await adapterModule.createAdapter(config);
    const result = await runDeterministicFullStackE2e({
      ...config,
      injectFailureAfter: args.injectFailureAfter,
    }, adapter);
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      runId: result.marker.runId,
      sourceModes: result.modes.map(({ sourceMode }) => sourceMode),
      plans: result.provisioning.map(({ plan }) => plan),
      cleanup: result.cleanup,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: 'failed',
      code: error.code || 'E2E_RUN_FAILED',
      message: error.message,
      failures: error.failures,
      cleanup: error.cleanup,
    })}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${argv[1]}`) await main();
