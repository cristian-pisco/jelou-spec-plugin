import { describe, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { proveLocalDatabaseTarget } from '../../bin/lib/dev-orchestrator/stack/local-target.mjs';

describe('local database target proof', () => {
  const registeredDatabase = {
    id: 'local-postgres',
    host: 'postgres',
    port: 5432,
    composeProject: 'jelou-api-local',
    composeFile: '/repos/jelou-api/docker-compose.yml',
    service: 'postgres',
  };

  test('accepts loopback endpoints and an exact registered local Docker topology', () => {
    assert.deepEqual(
      proveLocalDatabaseTarget({ host: '127.0.0.1', port: 5432 }),
      { kind: 'loopback', host: '127.0.0.1', port: 5432 },
    );
    assert.deepEqual(
      proveLocalDatabaseTarget({
        host: registeredDatabase.host,
        port: registeredDatabase.port,
        dockerServiceId: registeredDatabase.id,
        composeProject: registeredDatabase.composeProject,
        composeFile: registeredDatabase.composeFile,
        service: registeredDatabase.service,
      }, { registeredDockerServices: [registeredDatabase] }),
      {
        kind: 'registered-docker',
        host: 'postgres',
        port: 5432,
        serviceId: 'local-postgres',
        composeProject: 'jelou-api-local',
        composeFile: '/repos/jelou-api/docker-compose.yml',
        service: 'postgres',
      },
    );
  });

  test('rejects malformed, remote, and string-ID-only targets', () => {
    const cases = [
      [{ host: '', port: 5432 }, {}, /database host is required/],
      [{ host: 'localhost', port: 0 }, {}, /database port must be between 1 and 65535/],
      [{ host: 'localhost', port: 65536 }, {}, /database port must be between 1 and 65535/],
      [{ host: 'db.shared.example', port: 5432 }, {}, /not proven local/],
      [{ host: 'postgres', port: 5432, dockerServiceId: 'unknown-db' }, { registeredDockerServices: ['local-postgres'] }, /not proven local/],
      [{ host: 'shared-db.example', port: 5432, dockerServiceId: 'local-postgres' }, { registeredDockerServices: ['local-postgres'] }, /not proven local/],
    ];

    for (const [target, topology, expected] of cases) {
      assert.throws(() => proveLocalDatabaseTarget(target, topology), expected);
    }
    assert.doesNotThrow(() => proveLocalDatabaseTarget({ host: 'localhost', port: 1 }));
    assert.doesNotThrow(() => proveLocalDatabaseTarget({ host: '::1', port: 65535 }));
  });

  test('rejects every mismatch from an otherwise valid registered Docker target', () => {
    const target = {
      host: registeredDatabase.host,
      port: registeredDatabase.port,
      dockerServiceId: registeredDatabase.id,
      composeProject: registeredDatabase.composeProject,
      composeFile: registeredDatabase.composeFile,
      service: registeredDatabase.service,
    };
    const mismatches = {
      host: 'shared-db.example',
      port: 6432,
      dockerServiceId: 'other-postgres',
      composeProject: 'other-project',
      composeFile: '/repos/other/docker-compose.yml',
      service: 'database',
    };

    for (const [field, value] of Object.entries(mismatches)) {
      assert.throws(
        () => proveLocalDatabaseTarget({ ...target, [field]: value }, { registeredDockerServices: [registeredDatabase] }),
        /not proven local/,
        field,
      );
    }
  });
});
