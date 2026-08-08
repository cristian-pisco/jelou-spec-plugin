import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseLocalOnboardingArgs, runLocalOnboardingCli } from '../../bin/local-auth-onboarding.mjs';

function adapter() {
  return {
    bcrypt: { hash: async () => '$2b$12$redacted-hash' },
    database: {
      async transaction(work) {
        const result = await work({
          ensureCompanyPlan: () => {},
          reconcileCompany: (value) => value,
          reconcileChatbot: (value) => value,
          reconcileUser: (value) => value,
          reconcileAccess: (value) => value,
          reconcileOperator: (value) => value,
          reconcileRole: (value) => value,
          reconcileTwoFactor: (value) => value,
        });
        return { ...result, counts: { companies: 1, users: 1 } };
      },
    },
  };
}

describe('local-auth onboarding CLI', () => {
  test('accepts secrets only in the stdin request and returns sanitized metadata', async () => {
    const values = new Map();
    const keyring = {
      isAvailable: () => true,
      read: (identity) => values.get(identity) || null,
      replace: (identity, password) => values.set(identity, password),
      remove: (identity) => values.delete(identity),
    };
    const output = await runLocalOnboardingCli({
      requestText: JSON.stringify({
        workspaceId: 'workspace-a',
        taskSlug: 'task-a',
        runId: 'run-a',
        target: { host: 'localhost', port: 5432 },
        input: {
          company: { mode: 'existing' },
          user: { name: 'Local Developer', email: 'local@example.test', password: 'stdin-secret' },
        },
      }),
      adapter: adapter(),
      keyring,
    });

    assert.equal(output.status, 'provisioned');
    assert.equal(values.get('jlu-local-auth:workspace-a:task-a'), 'stdin-secret');
    assert.doesNotMatch(JSON.stringify(output), /stdin-secret|redacted-hash|passwordHash/);
    assert.throws(
      () => parseLocalOnboardingArgs(['--adapter-module', '/tmp/adapter.mjs', '--password', 'argv-secret']),
      /unsupported argument/,
    );
  });
});
