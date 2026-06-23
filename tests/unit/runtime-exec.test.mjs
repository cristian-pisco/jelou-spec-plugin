import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { DEFAULT_EXEC_TEMPLATE, substituteExecTemplate, resolveRuntimeExec } from '../../bin/lib/runtime-exec.mjs';

describe('runtime-exec — exec template', () => {
  test('default template shape', () => {
    assert.equal(DEFAULT_EXEC_TEMPLATE, 'docker compose -f {compose_file} exec {compose_service} {cmd}');
  });
  test('substitutes all placeholders', () => {
    const out = substituteExecTemplate(DEFAULT_EXEC_TEMPLATE, {
      composeFile: './docker-compose.yml', composeService: 'app', cmd: 'npm install',
    });
    assert.equal(out, 'docker compose -f ./docker-compose.yml exec app npm install');
  });
});

describe('runtime-exec — resolveRuntimeExec', () => {
  test('host runtime → empty prefix', () => {
    const r = resolveRuntimeExec({ service: { name: 'api', runtime: { type: 'host' } } });
    assert.deepEqual(r, { runtime: 'host', execPrefix: '' });
  });
  test('unregistered/no-runtime service → host, empty prefix', () => {
    assert.deepEqual(resolveRuntimeExec({ service: null }), { runtime: 'host', execPrefix: '' });
  });
  test('docker-compose → exec prefix from compose file + service', () => {
    const r = resolveRuntimeExec({
      service: { name: 'wf', runtime: { type: 'docker-compose', compose_file: './docker-compose.yml', compose_service: 'app' } },
    });
    assert.equal(r.runtime, 'docker-compose');
    assert.equal(r.execPrefix, 'docker compose -f ./docker-compose.yml exec app');
  });
  test('docker-compose honors custom exec_template', () => {
    const r = resolveRuntimeExec({
      service: { runtime: { type: 'docker-compose', compose_file: 'c.yml', compose_service: 'svc', exec_template: 'docker compose -f {compose_file} exec -T {compose_service} {cmd}' } },
    });
    assert.equal(r.execPrefix, 'docker compose -f c.yml exec -T svc');
  });
});
