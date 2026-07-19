// tests/unit/boot-engine-task-isolated-eligibility.test.mjs
//
// Run: `node --test tests/unit/boot-engine-task-isolated-eligibility.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { partitionBootOrder } from '../../bin/lib/boot-engine/task-isolated-eligibility.mjs';

describe('partitionBootOrder', () => {
  test('docker-exec + worktree + in registry -> eligible', () => {
    const out = partitionBootOrder({
      services: [{ id: 'jelou-api', dev: { launcher: 'docker-exec' } }],
      worktreePaths: { 'jelou-api': '/wt/jelou-api' },
      unifiedRegistryIds: new Set(['jelou-api'])
    });
    assert.deepEqual(out, { eligible: ['jelou-api'], passthrough: [], warnWorktreeNotIsolated: [] });
  });

  test('docker-exec + worktree but NOT in registry -> warn (not eligible)', () => {
    const out = partitionBootOrder({
      services: [{ id: 'custom-svc', dev: { launcher: 'docker-exec' } }],
      worktreePaths: { 'custom-svc': '/wt/custom' },
      unifiedRegistryIds: new Set(['jelou-api'])
    });
    assert.deepEqual(out, { eligible: [], passthrough: [], warnWorktreeNotIsolated: ['custom-svc'] });
  });

  test('npm worktree service -> passthrough', () => {
    const out = partitionBootOrder({
      services: [{ id: 'jelou-apps', dev: { launcher: 'npm' } }],
      worktreePaths: { 'jelou-apps': '/wt/jelou-apps' },
      unifiedRegistryIds: new Set(['jelou-apps'])
    });
    assert.deepEqual(out, { eligible: [], passthrough: ['jelou-apps'], warnWorktreeNotIsolated: [] });
  });

  test('docker-exec with no worktree -> passthrough', () => {
    const out = partitionBootOrder({
      services: [{ id: 'jelou-api', dev: { launcher: 'docker-exec' } }],
      worktreePaths: {},
      unifiedRegistryIds: new Set(['jelou-api'])
    });
    assert.deepEqual(out, { eligible: [], passthrough: ['jelou-api'], warnWorktreeNotIsolated: [] });
  });

  test('mixed set partitions correctly and preserves order', () => {
    const out = partitionBootOrder({
      services: [
        { id: 'jelou-api', dev: { launcher: 'docker-exec' } },
        { id: 'chatbot-server', dev: { launcher: 'docker-exec' } },
        { id: 'jelou-apps', dev: { launcher: 'npm' } },
        { id: 'custom-svc', dev: { launcher: 'docker-exec' } }
      ],
      worktreePaths: { 'jelou-api': '/wt/a', 'jelou-apps': '/wt/f', 'custom-svc': '/wt/c' },
      unifiedRegistryIds: new Set(['jelou-api', 'chatbot-server', 'jelou-apps'])
    });
    assert.deepEqual(out, {
      eligible: ['jelou-api'],
      passthrough: ['chatbot-server', 'jelou-apps'],
      warnWorktreeNotIsolated: ['custom-svc']
    });
  });

  test('service with no dev block -> passthrough', () => {
    const out = partitionBootOrder({
      services: [{ id: 'x' }],
      worktreePaths: { 'x': '/wt/x' },
      unifiedRegistryIds: new Set(['x'])
    });
    assert.deepEqual(out, { eligible: [], passthrough: ['x'], warnWorktreeNotIsolated: [] });
  });
});
