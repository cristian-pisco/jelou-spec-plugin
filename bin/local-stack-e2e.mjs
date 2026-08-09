#!/usr/bin/env node
import { argv } from 'node:process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveLocalStackE2eConfig } from './lib/dev-orchestrator/stack/local-stack-e2e-config.mjs';
import { createAdapter as createRegisteredAdapter } from './lib/dev-orchestrator/stack/local-stack-e2e-adapter.mjs';

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

const REQUIRED_EVIDENCE_FIELDS = [
  'reachability',
  'overlayRestarts',
  'onboarding',
  'database',
  'credentials',
  'authentication',
  'redaction',
];

const CLEANUP_KINDS = [
  'worktree',
  'process',
  'container',
  'overlay',
  'runtimeFile',
  'keyringEntry',
  'databaseRecord',
];

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

function incompleteEvidence(message) {
  const error = new Error(message);
  error.code = 'E2E_EVIDENCE_INCOMPLETE';
  return error;
}

function normalizeEvidence(result) {
  const evidence = result?.evidence || result;
  if (!evidence || typeof evidence !== 'object') {
    throw incompleteEvidence('stack driver returned no live evidence');
  }
  const missing = REQUIRED_EVIDENCE_FIELDS.filter((field) => evidence[field] === undefined);
  if (missing.length > 0) {
    throw incompleteEvidence(`stack driver omitted live evidence fields: ${missing.join(', ')}`);
  }
  return Object.fromEntries(REQUIRED_EVIDENCE_FIELDS.map((field) => [field, evidence[field]]));
}

function normalizeCleanupEvidence(result, resources, marker) {
  if (!result || typeof result !== 'object') {
    throw incompleteEvidence('stack driver returned no cleanup residue evidence');
  }
  const missing = CLEANUP_KINDS.filter((kind) => !result.inventory?.[kind]);
  if (missing.length > 0) {
    throw incompleteEvidence(`stack driver omitted cleanup residue kinds: ${missing.join(', ')}`);
  }
  const inventory = Object.fromEntries(CLEANUP_KINDS.map((kind) => {
    const created = new Set(resources
      .filter((resource) => resource.kind === kind && sameMarker(resource.owner, marker))
      .map(({ id }) => id)).size;
    return [kind, { created, remaining: result.inventory[kind].remaining }];
  }));
  const invalid = CLEANUP_KINDS.filter((kind) => (
    inventory[kind].created <= 0
    || !Number.isInteger(inventory[kind].remaining)
    || inventory[kind].remaining < 0
  ));
  if (invalid.length > 0) {
    throw incompleteEvidence(`stack driver returned invalid cleanup residue evidence for: ${invalid.join(', ')}`);
  }
  if (!Array.isArray(result.preserved)) {
    throw incompleteEvidence('stack driver omitted preserved-resource evidence');
  }
  return {
    inventory,
    preserved: result.preserved,
  };
}

function assertSecretsRedacted(evidence, secrets) {
  const serialized = JSON.stringify(evidence);
  if (secrets.some((secret) => secret && serialized.includes(secret))) {
    const error = new Error('live evidence contained a secret value');
    error.code = 'E2E_SECRET_LEAK';
    throw error;
  }
}

function redactKnownSecret(value, secret) {
  if (typeof value !== 'string' || !secret) return value;
  return value.replaceAll(secret, '[REDACTED]');
}

async function collectLiveEvidence(options, adapter, input, resources) {
  if (typeof adapter.collectEvidence !== 'function') return undefined;
  const result = await adapter.collectEvidence({
    options,
    ...input,
    passwordCanary: options.passwordCanary,
  });
  resources.push(...(result?.resources || []));
  const evidence = normalizeEvidence(result);
  assertSecretsRedacted(evidence, [
    options.passwordCanary,
    ...Object.values(input.identity.users).map(({ password }) => password),
  ]);
  return evidence;
}

async function collectCleanupEvidence(adapter, resources, marker, cleanup) {
  if (typeof adapter.inspectCleanup !== 'function') return cleanup;
  const result = {
    ...cleanup,
    ...normalizeCleanupEvidence(await adapter.inspectCleanup({ resources, marker, cleanup }), resources, marker),
  };
  const residue = CLEANUP_KINDS.filter((kind) => result.inventory[kind].remaining > 0);
  if (residue.length > 0) {
    const error = new Error(`local-stack E2E left owned resource residue: ${residue.join(', ')}`);
    error.code = 'E2E_CLEANUP_FAILED';
    error.cleanup = result;
    throw error;
  }
  return result;
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
    const modes = [main, taskAware, taskAwareRepeated];
    const evidence = await collectLiveEvidence(options, adapter, {
      fixture,
      identity,
      modes,
      provisioning,
      registerResource,
    }, resources);
    report = {
      status: 'passed',
      preflight,
      marker: identity.marker,
      fixture,
      modes,
      provisioning,
      ...(evidence ? { evidence } : {}),
    };
  } catch (error) {
    failure = error;
  }
  let cleanup = await cleanupOwnedResources(resources, identity.marker, adapter.cleanupResource);
  if (typeof adapter.inspectCleanup === 'function') {
    try {
      cleanup = await collectCleanupEvidence(adapter, resources, identity.marker, cleanup);
    } catch (error) {
      cleanup = error.cleanup || cleanup;
      error.cleanup = cleanup;
      if (!failure) failure = error;
      else failure.cleanupInspectionFailure = error.message;
    }
  }
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
  try {
    const config = args.configPath
      ? JSON.parse(readFileSync(resolve(args.configPath), 'utf8'))
      : resolveLocalStackE2eConfig();
    let adapter;
    if (config.adapterPath) {
      const adapterModule = await import(pathToFileURL(resolve(config.adapterPath)).href);
      if (typeof adapterModule.createAdapter !== 'function') throw new Error('E2E adapter must export createAdapter(config)');
      adapter = await adapterModule.createAdapter(config);
    } else {
      adapter = await createRegisteredAdapter(config);
    }
    const result = await runDeterministicFullStackE2e({
      ...config,
      injectFailureAfter: args.injectFailureAfter,
      passwordCanary: process.env.JLU_LOCAL_STACK_E2E_PASSWORD_CANARY,
    }, adapter);
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      runId: result.marker.runId,
      sourceModes: result.modes.map(({ sourceMode }) => sourceMode),
      plans: result.provisioning.map(({ plan }) => plan),
      evidence: result.evidence,
      cleanup: result.cleanup,
    })}\n`);
  } catch (error) {
    const passwordCanary = process.env.JLU_LOCAL_STACK_E2E_PASSWORD_CANARY;
    process.stderr.write(`${JSON.stringify({
      status: 'failed',
      code: error.code || 'E2E_RUN_FAILED',
      message: redactKnownSecret(error.message, passwordCanary),
      failures: error.failures,
      cleanup: error.cleanup,
      cleanupInspectionFailure: redactKnownSecret(error.cleanupInspectionFailure, passwordCanary),
    })}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${argv[1]}`) await main();
