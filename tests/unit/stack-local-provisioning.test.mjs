import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { onboardLocalAuth } from '../../bin/lib/dev-orchestrator/stack/local-provisioning.mjs';

function createDatabase() {
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
      const one = (collection, key, value) => {
        const index = draft[collection].findIndex((entry) => entry[key] === value[key]);
        if (index === -1) draft[collection].push(value);
        else draft[collection][index] = { ...draft[collection][index], ...value };
        return draft[collection].find((entry) => entry[key] === value[key]);
      };
      const result = await work({
        ensureCompanyPlan: (plan) => stage('plan', () => { if (!draft.plans.includes(plan)) draft.plans.push(plan); }),
        reconcileCompany: (value) => stage('company', () => one('companies', 'profileIdentity', value)),
        reconcileChatbot: (value) => stage('chatbot', () => one('chatbots', 'companyId', value)),
        reconcileUser: (value) => stage('user', () => one('users', 'email', value)),
        reconcileAccess: (value) => stage('access', () => one('accesses', 'identity', value)),
        reconcileOperator: (value) => stage('operator', () => one('operators', 'identity', value)),
        reconcileRole: (value) => stage('role', () => one('roles', 'identity', value)),
        reconcileTwoFactor: (value) => stage('twoFactor', () => one('twoFactors', 'userId', value)),
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

const bcrypt = {
  hash: async (password) => `$2b$12$${password}`,
  verify: async (password, hash) => hash === `$2b$12$${password}`,
};

describe('transactional local-auth provisioning', () => {
  test('a proven local target receives SELF_SERVICE and a complete authenticatable user graph', async () => {
    const keyring = createKeyring();
    const result = await onboardLocalAuth({
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      runId: 'run-a',
      target: { host: '127.0.0.1', port: 5432 },
      input: {
        company: { mode: 'new', name: 'Local Company', plan: 'SELF_SERVICE' },
        user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
      },
    }, { keyring, database: createDatabase(), bcrypt });

    assert.equal(result.status, 'provisioned');
    assert.equal(result.graph.company.plan, 'SELF_SERVICE');
    assert.equal(result.graph.chatbot.companyId, result.graph.company.id);
    assert.equal(result.graph.user.active, true);
    assert.equal(result.graph.user.emailVerified, true);
    assert.equal(await bcrypt.verify('secret-value', result.graph.user.passwordHash), true);
    assert.equal(result.graph.access.companyId, result.graph.company.id);
    assert.equal(result.graph.operator.userId, result.graph.user.id);
    assert.equal(result.graph.role.roleKey, 'LOCAL_DEVELOPER');
    assert.equal(result.graph.twoFactor.required, false);
    assert.equal(keyring.read(result.profile.keyringIdentity), 'secret-value');
    assert.deepEqual(result.counts, { plans: 1, companies: 1, chatbots: 1, users: 1, accesses: 1, operators: 1, roles: 1, twoFactors: 1 });
  });

  test('repeated onboarding reconciles the populated graph without duplicates or plan translation', async () => {
    const database = createDatabase();
    const keyring = createKeyring();
    const options = {
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      runId: 'run-a',
      target: { host: 'localhost', port: 5432 },
      input: {
        company: { mode: 'new', name: 'Local Company', plan: 'SELF_SERVICE' },
        user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
      },
    };

    await onboardLocalAuth(options, { keyring, database, bcrypt });
    const repeated = await onboardLocalAuth({ ...options, runId: 'run-b' }, { keyring, database, bcrypt });

    assert.deepEqual(repeated.counts, { plans: 1, companies: 1, chatbots: 1, users: 1, accesses: 1, operators: 1, roles: 1, twoFactors: 1 });
    assert.equal(repeated.graph.company.plan, 'SELF_SERVICE');
    assert.notEqual(repeated.graph.company.plan, 'POCKET');
    assert.equal(repeated.graph.role.roleKey, 'LOCAL_DEVELOPER');
  });

  test('invalid onboarding input is rejected before keyring or database access', async () => {
    const unexpected = () => { throw new Error('unexpected boundary access'); };
    await assert.rejects(
      () => onboardLocalAuth({
        workspaceId: 'workspace-a',
        taskSlug: 'task-a',
        runId: 'run-a',
        target: { host: 'localhost', port: 5432 },
        input: {
          company: { mode: 'new', name: 'Local Company', plan: 'POCKET' },
          user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
        },
      }, {
        keyring: { isAvailable: unexpected, read: unexpected, replace: unexpected, remove: unexpected },
        database: { transaction: unexpected },
        bcrypt: { hash: unexpected },
      }),
      /company plan must be ENTERPRISE or SELF_SERVICE/,
    );
  });

  test('missing keyring support aborts with remediation before credential or authentication-data mutation', async () => {
    const unexpected = () => { throw new Error('unexpected mutation'); };
    await assert.rejects(
      () => onboardLocalAuth({
        workspaceId: 'workspace-a',
        taskSlug: 'task-a',
        runId: 'run-a',
        target: { host: 'localhost', port: 5432 },
        input: {
          company: { mode: 'existing' },
          user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
        },
      }, {
        keyring: { isAvailable: () => false, read: unexpected, replace: unexpected, remove: unexpected },
        database: { transaction: unexpected },
        bcrypt: { hash: unexpected },
      }),
      /install and unlock a supported keyring/,
    );
  });

  test('a nonlocal database target is rejected before credential lookup DDL or DML', async () => {
    const unexpected = () => { throw new Error('unexpected credential or database access'); };
    await assert.rejects(
      () => onboardLocalAuth({
        workspaceId: 'workspace-a',
        taskSlug: 'task-a',
        runId: 'run-a',
        target: { host: 'shared-db.example.com', port: 5432 },
        input: {
          company: { mode: 'existing' },
          user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
        },
      }, {
        keyring: { isAvailable: () => true, read: unexpected, replace: unexpected, remove: unexpected },
        database: { transaction: unexpected },
        bcrypt: { hash: unexpected },
      }),
      /not proven local/,
    );
  });

  test('every transactional stage failure leaves the committed graph unchanged and restores the last usable password', async () => {
    for (const stage of ['plan', 'company', 'chatbot', 'user', 'access', 'operator', 'role', 'twoFactor', 'commit']) {
      const database = createDatabase();
      const keyring = createKeyring();
      const base = {
        workspaceId: 'workspace-a',
        taskSlug: 'task-a',
        runId: 'run-a',
        target: { host: 'localhost', port: 5432 },
        input: {
          company: { mode: 'new', name: 'Original Company', plan: 'ENTERPRISE' },
          user: { name: 'Original User', email: 'local@example.test', password: 'old-secret' },
        },
      };
      const committed = await onboardLocalAuth(base, { keyring, database, bcrypt });
      const previousState = database.snapshot();
      database.failAt(stage);

      await assert.rejects(
        () => onboardLocalAuth({
          ...base,
          runId: 'run-b',
          input: {
            company: { mode: 'new', name: 'Replacement Company', plan: 'SELF_SERVICE' },
            user: { name: 'Replacement User', email: 'local@example.test', password: 'new-secret' },
          },
        }, { keyring, database, bcrypt }),
        /previous usable keyring profile was restored/,
      );
      assert.deepEqual(database.snapshot(), previousState);
      assert.equal(keyring.read(committed.profile.keyringIdentity), 'old-secret');
    }
  });

  test('existing company 135 is reused without claiming cleanup ownership', async () => {
    const result = await onboardLocalAuth({
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      runId: 'run-a',
      target: { host: 'localhost', port: 5432 },
      input: {
        company: { mode: 'existing' },
        user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
      },
    }, { keyring: createKeyring(), database: createDatabase(), bcrypt });

    assert.equal(result.graph.company.id, 135);
    assert.equal(result.graph.company.existing, true);
    assert.equal(result.graph.company.owner, undefined);
  });

  test('cleanup artifacts identify only the current profile credential and owned records', async () => {
    const result = await onboardLocalAuth({
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      runId: 'run-a',
      target: { host: 'localhost', port: 5432 },
      input: {
        company: { mode: 'existing' },
        user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
      },
    }, { keyring: createKeyring(), database: createDatabase(), bcrypt });

    assert.equal(result.cleanupResources[0].kind, 'credential');
    assert.equal(result.cleanupResources[0].resource.identity, 'jlu-local-auth:workspace-a:task-a');
    assert.equal(result.cleanupResources.some(({ resource }) => resource.entity === 'company'), false);
    assert.equal(result.cleanupResources.filter(({ kind }) => kind === 'testData').length, 6);
    assert.equal(result.cleanupResources.every(({ resource }) => resource.owner.runId === 'run-a'), true);
    assert.doesNotMatch(JSON.stringify(result.cleanupResources), /secret-value|passwordHash/);
  });

  test('a complete metadata profile is not reusable when its operating-system keyring is unavailable', async () => {
    await assert.rejects(
      () => onboardLocalAuth({
        workspaceId: 'workspace-a',
        taskSlug: 'task-a',
        runId: 'run-a',
        target: { host: 'localhost', port: 5432 },
        storedProfile: {
          workspaceId: 'workspace-a',
          taskSlug: 'task-a',
          company: { mode: 'existing', id: 135 },
          user: { name: 'Local Developer', email: 'local@example.test' },
          keyringIdentity: 'jlu-local-auth:workspace-a:task-a',
        },
      }, {
        keyring: { isAvailable: () => false },
        database: { transaction: () => { throw new Error('unexpected database mutation'); } },
        bcrypt,
      }),
      /install and unlock a supported keyring/,
    );
  });

  test('the enum migration finishes before any company graph reconciliation begins', async () => {
    let migrationFinished = false;
    const database = {
      async transaction(work) {
        const passthrough = (value) => value;
        const result = await work({
          ensureCompanyPlan: async () => {
            await new Promise((resolve) => queueMicrotask(resolve));
            migrationFinished = true;
          },
          reconcileCompany: (value) => {
            if (!migrationFinished) throw new Error('company reconciliation started before migration completed');
            return value;
          },
          reconcileChatbot: passthrough,
          reconcileUser: passthrough,
          reconcileAccess: passthrough,
          reconcileOperator: passthrough,
          reconcileRole: passthrough,
          reconcileTwoFactor: passthrough,
        });
        return { ...result, counts: {} };
      },
    };

    const result = await onboardLocalAuth({
      workspaceId: 'workspace-a',
      taskSlug: 'task-a',
      runId: 'run-a',
      target: { host: 'localhost', port: 5432 },
      input: {
        company: { mode: 'new', name: 'Local Company', plan: 'ENTERPRISE' },
        user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
      },
    }, { keyring: createKeyring(), database, bcrypt });

    assert.equal(result.status, 'provisioned');
    assert.equal(migrationFinished, true);
  });

  test('bcrypt failure is redacted and occurs before keyring or database mutation', async () => {
    const unexpected = () => { throw new Error('unexpected mutation'); };
    await assert.rejects(
      () => onboardLocalAuth({
        workspaceId: 'workspace-a',
        taskSlug: 'task-a',
        runId: 'run-a',
        target: { host: 'localhost', port: 5432 },
        input: {
          company: { mode: 'existing' },
          user: { name: 'Local Developer', email: 'local@example.test', password: 'secret-value' },
        },
      }, {
        keyring: { isAvailable: () => true, read: () => null, replace: unexpected, remove: unexpected },
        database: { transaction: unexpected },
        bcrypt: { hash: async () => { throw new Error('hash rejected secret-value'); } },
      }),
      (error) => error.message === 'bcrypt password hashing failed',
    );
  });
});
