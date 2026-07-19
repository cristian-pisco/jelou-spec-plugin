// tests/unit/stack-observer-plan.test.mjs
//
// Run: `node --test tests/unit/stack-observer-plan.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { observerPlanFromBootPlan } from '../../bin/lib/dev-orchestrator/stack/observer-plan.mjs';

describe('observerPlanFromBootPlan', () => {
  test('task-isolated -> exec-file with projectName; shared-reuse -> docker-logs without container', () => {
    const plan = { services: [
      { id: 'jelou-api', policy: 'task-isolated', projectName: 'jelou-api-t1' },
      { id: 'dashboard-server', policy: 'shared-reuse' }
    ] };
    assert.deepEqual(observerPlanFromBootPlan(plan), [
      { name: 'jelou-api', policy: 'task-isolated', logMode: 'exec-file', projectName: 'jelou-api-t1' },
      { name: 'dashboard-server', policy: 'shared-reuse', logMode: 'docker-logs' }
    ]);
  });
});
