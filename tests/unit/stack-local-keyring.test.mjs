import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createOsKeyring } from '../../bin/lib/dev-orchestrator/stack/local-keyring.mjs';

describe('operating-system local-auth keyring', () => {
  test('stores reads and removes task-isolated passwords without exposing them through argv or env', () => {
    const calls = [];
    const values = new Map();
    const run = (command, args, options = {}) => {
      calls.push({ command, args, options });
      const account = args.at(-1);
      if (args[0] === '--version') return { status: 0, stdout: 'secret-tool 1.0\n', stderr: '' };
      if (args[0] === 'store') {
        values.set(account, options.input);
        return { status: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'lookup') return { status: values.has(account) ? 0 : 1, stdout: values.get(account) || '', stderr: '' };
      values.delete(account);
      return { status: 0, stdout: '', stderr: '' };
    };
    const keyring = createOsKeyring({ run });

    assert.equal(keyring.isAvailable(), true);
    keyring.replace('jlu-local-auth:workspace-a:task-a', 'same-email-password-a');
    keyring.replace('jlu-local-auth:workspace-a:task-b', 'same-email-password-b');
    assert.equal(keyring.read('jlu-local-auth:workspace-a:task-a'), 'same-email-password-a');
    assert.equal(keyring.read('jlu-local-auth:workspace-a:task-b'), 'same-email-password-b');
    keyring.remove('jlu-local-auth:workspace-a:task-a');
    assert.equal(keyring.read('jlu-local-auth:workspace-a:task-a'), null);

    const serializedArguments = JSON.stringify(calls.map(({ command, args, options }) => ({ command, args, env: options.env })));
    assert.doesNotMatch(serializedArguments, /same-email-password-a|same-email-password-b/);
    assert.equal(calls.find(({ args }) => args[0] === 'store').options.input, 'same-email-password-a');
  });
});
