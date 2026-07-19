// tests/unit/boot-engine-cli.test.mjs
//
// Run: `node --test tests/unit/boot-engine-cli.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedRegistry } from '../../bin/seed-registry.mjs';
import { buildPlanForWorkspace } from '../../bin/build-boot-plan.mjs';

describe('buildPlanForWorkspace', () => {
  test('reads the seeded registry and builds a plan (injected worktrees/occupied/image)', () => {
    const ws = mkdtempSync(join(tmpdir(), 'jlu-plan-'));
    seedRegistry({ workspaceRoot: ws });
    const plan = buildPlanForWorkspace({
      workspaceRoot: ws,
      slug: 't1',
      worktreePaths: { 'jelou-api': '/wt/jelou-api' },
      occupied: [],
      resolveImage: () => 'jelou-api-app',
      readEnv: () => ''
    });
    assert.ok(plan.services.length >= 12);
    const api = plan.services.find((s) => s.id === 'jelou-api');
    assert.equal(api.policy, 'task-isolated');
    assert.equal(api.projectName, 'jelou-api-t1');
    const dash = plan.services.find((s) => s.id === 'dashboard-server');
    assert.equal(dash.policy, 'shared-reuse');
  });
});
