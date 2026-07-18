// tests/unit/stack-override.test.mjs
//
// Run: `node --test tests/unit/stack-override.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { renderOverride } from '../../bin/lib/dev-orchestrator/stack/override.mjs';

describe('renderOverride', () => {
  const service = { name: 'api-gateway-service', compose_service: 'app' };
  const allocations = [{ internal: 8080, host: 3100 }, { internal: 9001, host: 3101 }];

  test('renders project name, container_name, override ports and alias', () => {
    const yaml = renderOverride({ service, slug: 'add-oauth-flow', allocations, networkAlias: 'app-network' });
    assert.equal(yaml, [
      'name: api-gateway-service-add-oauth-flow',
      '',
      'services:',
      '  app:',
      '    container_name: api-gateway-service-add-oauth-flow',
      '    ports: !override',
      '      - "3100:8080"',
      '      - "3101:9001"',
      '    networks:',
      '      app-network:',
      '        aliases:',
      '          - api-gateway-service-add-oauth-flow',
      ''
    ].join('\n'));
  });

  test('projectName helper joins name and slug', () => {
    assert.equal(renderOverride({ service, slug: 's', allocations, networkAlias: 'app-network' }).startsWith('name: api-gateway-service-s\n'), true);
  });
});
