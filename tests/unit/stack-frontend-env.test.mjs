// tests/unit/stack-frontend-env.test.mjs
//
// Run: `node --test tests/unit/stack-frontend-env.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { rewriteFrontendEnv } from '../../bin/lib/dev-orchestrator/stack/frontend-env.mjs';

describe('rewriteFrontendEnv', () => {
  const envLocal = {
    NX_API: { service: 'jelou-api', suffix: '' },
    NX_DASH: { service: 'dashboard-server', suffix: '/api' }
  };
  const envBlank = ['NX_SECRET'];
  const hostByService = { 'jelou-api': 13100, 'dashboard-server': 13200 };

  test('rewrites existing keys and appends absent ones', () => {
    const input = 'KEEP=1\nNX_API=http://localhost:8383\nNX_SECRET=leak\n';
    const out = rewriteFrontendEnv({ envText: input, envLocal, envBlank, hostByService });
    assert.equal(out, 'KEEP=1\nNX_API=http://localhost:13100\nNX_SECRET=\nNX_DASH=http://localhost:13200/api\n');
  });

  test('appends all managed keys when the file is empty', () => {
    const out = rewriteFrontendEnv({ envText: '', envLocal, envBlank, hostByService });
    assert.equal(out, 'NX_API=http://localhost:13100\nNX_DASH=http://localhost:13200/api\nNX_SECRET=\n');
  });
});
