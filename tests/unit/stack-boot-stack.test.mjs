// tests/unit/stack-boot-stack.test.mjs
//
// Run: `node --test tests/unit/stack-boot-stack.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { bootStack } from '../../bin/lib/dev-orchestrator/stack/boot-stack.mjs';

const entry = (name, host) => ({
  name,
  projectName: `${name}-t`,
  cwd: `/repo/${name}`,
  mode: 'exec',
  command: 'yarn dev',
  composeFile: 'docker-compose.yml',
  readiness: { type: 'http', url: 'http://localhost:8080/' },
  ports: [{ internal: 8080, host, portEnv: 'APP_PORT', primary: true }],
  overrideYaml: 'name: x\n',
  wiredEnv: ''
});

describe('bootStack', () => {
  test('boots every service and reports green when all probes pass', async () => {
    const runs = [];
    const out = await bootStack({
      plan: [entry('a', 13100), entry('b', 13200)],
      writeFile: () => {},
      run: (bin, args) => { runs.push(args[0]); return { status: 0 }; },
      probe: async () => true,
      delay: async () => {}
    });
    assert.equal(out.green, true);
    assert.deepEqual(out.down, []);
    assert.ok(runs.includes('compose'));
    assert.ok(runs.includes('exec'));
  });

  test('reports the services still down after attempts are exhausted', async () => {
    const out = await bootStack({
      plan: [entry('a', 13100), entry('b', 13200)],
      writeFile: () => {},
      run: () => ({ status: 0 }),
      probe: async (url) => url.includes('13100') ? false : true,
      delay: async () => {},
      attempts: 3
    });
    assert.equal(out.green, false);
    assert.deepEqual(out.down, ['a']);
  });
});
