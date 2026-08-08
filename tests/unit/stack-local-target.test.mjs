import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { proveLocalDatabaseTarget } from '../../bin/lib/dev-orchestrator/stack/local-target.mjs';

describe('local database target proof', () => {
  test('accepts loopback endpoints and registered local Docker services as independent proofs', () => {
    assert.deepEqual(
      proveLocalDatabaseTarget({ host: '127.0.0.1', port: 5432 }),
      { kind: 'loopback', host: '127.0.0.1', port: 5432 },
    );
    assert.deepEqual(
      proveLocalDatabaseTarget(
        { host: 'postgres', port: 5432, dockerServiceId: 'local-postgres' },
        { registeredDockerServices: ['local-postgres', 'local-redis'] },
      ),
      { kind: 'registered-docker', host: 'postgres', port: 5432, serviceId: 'local-postgres' },
    );
  });

  test('rejects malformed remote and unregistered targets', () => {
    const cases = [
      [{ host: '', port: 5432 }, {}, /database host is required/],
      [{ host: 'localhost', port: 0 }, {}, /database port must be between 1 and 65535/],
      [{ host: 'localhost', port: 65536 }, {}, /database port must be between 1 and 65535/],
      [{ host: 'db.shared.example', port: 5432 }, {}, /not proven local/],
      [{ host: 'postgres', port: 5432, dockerServiceId: 'unknown-db' }, { registeredDockerServices: ['local-postgres'] }, /not proven local/],
    ];

    for (const [target, topology, expected] of cases) {
      assert.throws(() => proveLocalDatabaseTarget(target, topology), expected);
    }
    assert.doesNotThrow(() => proveLocalDatabaseTarget({ host: 'localhost', port: 1 }));
    assert.doesNotThrow(() => proveLocalDatabaseTarget({ host: '::1', port: 65535 }));
  });
});
