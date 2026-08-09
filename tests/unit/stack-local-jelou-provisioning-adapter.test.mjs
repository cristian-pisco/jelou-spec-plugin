import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProvisioningAdapter } from '../../bin/lib/dev-orchestrator/stack/local-jelou-provisioning-adapter.mjs';
import { onboardLocalAuth } from '../../bin/lib/dev-orchestrator/stack/local-provisioning.mjs';

function createBoundaryDatabase() {
  let state = { plans: [], companies: [], chatbots: [], users: [], accesses: [], operators: [], roles: [], twoFactors: [] };
  let failureStage = null;
  return {
    failAt(stage) {
      failureStage = stage;
    },
    snapshot() {
      return structuredClone(state);
    },
    async transaction(work) {
      const draft = structuredClone(state);
      const stage = (name, operation) => {
        if (failureStage === name) throw new Error(`forced ${name} failure`);
        return operation();
      };
      const reconcile = (collection, key, value) => {
        const index = draft[collection].findIndex((entry) => entry[key] === value[key]);
        if (index === -1) draft[collection].push(value);
        else draft[collection][index] = { ...draft[collection][index], ...value };
        return draft[collection].find((entry) => entry[key] === value[key]);
      };
      const result = await work({
        ensureCompanyPlan: (plan) => stage('plan', () => { if (!draft.plans.includes(plan)) draft.plans.push(plan); }),
        reconcileCompany: (value) => stage('company', () => reconcile('companies', 'profileIdentity', value)),
        reconcileChatbot: (value) => stage('chatbot', () => reconcile('chatbots', 'companyId', value)),
        reconcileUser: (value) => stage('user', () => reconcile('users', 'email', value)),
        reconcileAccess: (value) => stage('access', () => reconcile('accesses', 'identity', value)),
        reconcileOperator: (value) => stage('operator', () => reconcile('operators', 'identity', value)),
        reconcileRole: (value) => stage('role', () => reconcile('roles', 'identity', value)),
        reconcileTwoFactor: (value) => stage('twoFactor', () => reconcile('twoFactors', 'userId', value)),
      });
      if (failureStage === 'commit') throw new Error('forced commit failure');
      state = draft;
      return { ...result, counts: Object.fromEntries(Object.entries(state).map(([key, values]) => [key, values.length])) };
    },
  };
}

function createKeyring() {
  const values = new Map();
  return {
    isAvailable: () => true,
    read: (identity) => values.get(identity) || null,
    replace: (identity, password) => values.set(identity, password),
    remove: (identity) => values.delete(identity),
  };
}

function onboardingRequest(overrides = {}) {
  return {
    workspaceId: 'workspace-a',
    taskSlug: 'task-a',
    runId: 'run-a',
    target: { host: '127.0.0.1', port: 5432 },
    input: {
      company: { mode: 'new', name: 'Local Company', plan: 'SELF_SERVICE' },
      user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
    },
    ...overrides,
  };
}

async function createFactoryFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'local-jelou-adapter-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const provisioningBoundaryPath = join(root, 'registered-boundary.mjs');
  writeFileSync(provisioningBoundaryPath, 'export const registered = true;\n');
  const database = createBoundaryDatabase();
  const hashes = [];
  const bcrypt = {
    async hash(password) {
      const hash = `$2b$12$${password}`;
      hashes.push(hash);
      return hash;
    },
  };
  const request = onboardingRequest({
    topology: {
      registeredLoopbackDatabase: { host: '127.0.0.1', port: 5432, provisioningBoundaryPath },
    },
  });
  const adapter = await createProvisioningAdapter(request, {
    importModule: async () => ({ createLocalJelouBoundary: async () => ({ database, bcrypt }) }),
  });
  return { request, adapter, database, hashes, provisioningBoundaryPath };
}

describe('plugin-owned local Jelou provisioning adapter', () => {
  test('provisions the SELF_SERVICE graph with bcrypt and disabled per-user two-factor', async (t) => {
    const fixture = await createFactoryFixture(t);
    const result = await onboardLocalAuth(fixture.request, { keyring: createKeyring(), ...fixture.adapter });

    assert.equal(result.status, 'provisioned');
    assert.deepEqual(fixture.database.snapshot().plans, ['SELF_SERVICE']);
    assert.equal(result.graph.company.plan, 'SELF_SERVICE');
    assert.equal(result.graph.chatbot.companyId, result.graph.company.id);
    assert.equal(result.graph.user.passwordHash, '$2b$12$secret-value');
    assert.equal(result.graph.user.active, true);
    assert.equal(result.graph.user.emailVerified, true);
    assert.equal(result.graph.role.roleKey, 'LOCAL_DEVELOPER');
    assert.equal(result.graph.twoFactor.required, false);
    assert.deepEqual(fixture.hashes, ['$2b$12$secret-value']);
    assert.equal(result.cleanupResources.find(({ kind }) => kind === 'testData').resource.provisioningBoundaryPath, fixture.provisioningBoundaryPath);
  });

  test('reconciles repeated requests through the registered boundary without duplicate graph rows', async (t) => {
    const fixture = await createFactoryFixture(t);
    const keyring = createKeyring();
    await onboardLocalAuth(fixture.request, { keyring, ...fixture.adapter });
    const repeated = await onboardLocalAuth({ ...fixture.request, runId: 'run-b' }, { keyring, ...fixture.adapter });

    assert.deepEqual(repeated.counts, {
      plans: 1,
      companies: 1,
      chatbots: 1,
      users: 1,
      accesses: 1,
      operators: 1,
      roles: 1,
      twoFactors: 1,
    });
  });

  test('rolls back a failed registered-boundary transaction and restores the usable credential', async (t) => {
    const fixture = await createFactoryFixture(t);
    const keyring = createKeyring();
    const first = await onboardLocalAuth(fixture.request, { keyring, ...fixture.adapter });
    const committed = fixture.database.snapshot();
    fixture.database.failAt('role');

    await assert.rejects(
      () => onboardLocalAuth({
        ...fixture.request,
        runId: 'run-b',
        input: {
          company: { mode: 'new', name: 'Replacement', plan: 'ENTERPRISE' },
          user: { name: 'Replacement User', email: 'local@example.test', password: 'new-secret' },
        },
      }, { keyring, ...fixture.adapter }),
      /previous usable keyring profile was restored/,
    );
    assert.deepEqual(fixture.database.snapshot(), committed);
    assert.equal(keyring.read(first.profile.keyringIdentity), 'secret-value');
  });

  test('rejects a remote target before loading any provisioning boundary', async () => {
    let imported = false;
    await assert.rejects(
      () => createProvisioningAdapter(onboardingRequest({
        target: { host: 'shared-db.example', port: 5432 },
        topology: {
          registeredLoopbackDatabase: { host: '127.0.0.1', port: 5432, provisioningBoundaryPath: '/remote-boundary.mjs' },
        },
      }), {
        importModule: async () => {
          imported = true;
          return {};
        },
      }),
      /not proven local/,
    );
    assert.equal(imported, false);
  });
});
