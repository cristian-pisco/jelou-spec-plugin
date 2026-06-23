import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { DEFAULT_EXEC_TEMPLATE, substituteExecTemplate } from '../../bin/lib/runtime-exec.mjs';

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
