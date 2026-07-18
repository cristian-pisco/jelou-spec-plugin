// tests/unit/stack-boot-exec.test.mjs
//
// Run: `node --test tests/unit/stack-boot-exec.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { bootService } from '../../bin/lib/dev-orchestrator/stack/boot-exec.mjs';

describe('bootService', () => {
  test('writes files then runs each docker command from cwd', () => {
    const writes = [];
    const runs = [];
    const plan = {
      projectName: 'svc-a-task-x',
      cwd: '/repo/a',
      files: [{ path: '/repo/a/docker-compose.jlu.yml', content: 'yaml' }, { path: '/repo/a/.env', content: 'FOO=bar\n' }],
      commands: [['compose', 'up', '-d'], ['exec', '-d', 'svc-a-task-x', 'sh', '-lc', 'run']]
    };
    const writeFile = (p, c) => writes.push([p, c]);
    const run = (bin, args, opts) => { runs.push([bin, args, opts]); return { status: 0 }; };

    const out = bootService({ plan, writeFile, run });

    assert.deepEqual(writes, [['/repo/a/docker-compose.jlu.yml', 'yaml'], ['/repo/a/.env', 'FOO=bar\n']]);
    assert.equal(runs.length, 2);
    assert.deepEqual(runs[0], ['docker', ['compose', 'up', '-d'], { cwd: '/repo/a' }]);
    assert.deepEqual(runs[1], ['docker', ['exec', '-d', 'svc-a-task-x', 'sh', '-lc', 'run'], { cwd: '/repo/a' }]);
    assert.equal(out.projectName, 'svc-a-task-x');
    assert.equal(out.results.length, 2);
  });
});
