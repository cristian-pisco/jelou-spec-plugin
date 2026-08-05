import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { composeMountsArgs, resolveComposeMounts } from '../../bin/lib/dev-orchestrator/stack/resolve-compose-mounts.mjs';

const CONFIG = {
  services: {
    app: {
      image: 'jelou/jelou-api-gateway:latest',
      environment: { DB_PASSWORD: 'super-secret', API_TOKEN: 'tok_live_abc' },
      volumes: [
        { type: 'bind', source: '/repo/api-gateway', target: '/app', bind: { create_host_path: true } },
        { type: 'volume', target: '/app/node_modules', volume: {} }
      ]
    }
  }
};

function runner(result) {
  return () => result;
}

describe('composeMountsArgs', () => {
  test('asks compose for the resolved config as json', () => {
    assert.deepEqual(composeMountsArgs({ composeFile: 'docker-compose.yml' }), ['compose', '-f', 'docker-compose.yml', 'config', '--format', 'json']);
  });
});

describe('resolveComposeMounts', () => {
  test('extracts type, target and source for each mount', () => {
    const mounts = resolveComposeMounts({ cwd: '/repo/api-gateway', composeFile: 'docker-compose.yml', composeService: 'app', run: runner({ status: 0, stdout: JSON.stringify(CONFIG) }) });
    assert.deepEqual(mounts, [
      { type: 'bind', target: '/app', source: '/repo/api-gateway' },
      { type: 'volume', target: '/app/node_modules', source: null }
    ]);
  });

  test('returns only mount fields, never environment or other config', () => {
    const mounts = resolveComposeMounts({ cwd: '/x', composeFile: 'docker-compose.yml', composeService: 'app', run: runner({ status: 0, stdout: JSON.stringify(CONFIG) }) });
    const serialized = JSON.stringify(mounts);
    assert.doesNotMatch(serialized, /super-secret/);
    assert.doesNotMatch(serialized, /tok_live_abc/);
    assert.doesNotMatch(serialized, /environment/);
    for (const m of mounts) assert.deepEqual(Object.keys(m).sort(), ['source', 'target', 'type']);
  });

  test('fails open on a non-zero docker exit', () => {
    assert.equal(resolveComposeMounts({ cwd: '/x', composeFile: 'docker-compose.yml', composeService: 'app', run: runner({ status: 1, stdout: '' }) }), null);
  });

  test('fails open on unparseable output', () => {
    assert.equal(resolveComposeMounts({ cwd: '/x', composeFile: 'docker-compose.yml', composeService: 'app', run: runner({ status: 0, stdout: 'not json' }) }), null);
  });

  test('fails open when the service declares no volumes', () => {
    const config = { services: { app: { image: 'x' } } };
    assert.equal(resolveComposeMounts({ cwd: '/x', composeFile: 'docker-compose.yml', composeService: 'app', run: runner({ status: 0, stdout: JSON.stringify(config) }) }), null);
  });

  test('fails open when the compose service is absent', () => {
    assert.equal(resolveComposeMounts({ cwd: '/x', composeFile: 'docker-compose.yml', composeService: 'missing', run: runner({ status: 0, stdout: JSON.stringify(CONFIG) }) }), null);
  });
});
