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

  test('exec service injects image, pull_policy, build-reset, and idles the entrypoint', () => {
    const yaml = renderOverride({
      service: { name: 'jelou-api', compose_service: 'app', mode: 'exec' },
      slug: 't42',
      allocations: [{ host: 3100, internal: 8080 }],
      networkAlias: 'app-network',
      image: 'jelou-api-app'
    });
    assert.equal(yaml, [
      'name: jelou-api-t42', '',
      'services:',
      '  app:',
      '    container_name: jelou-api-t42',
      '    image: jelou-api-app',
      '    pull_policy: never',
      '    build: !reset null',
      '    entrypoint: ["sleep", "infinity"]',
      '    command: !reset null',
      '    ports: !override',
      '      - "3100:8080"',
      '    networks:',
      '      app-network:',
      '        aliases:',
      '          - jelou-api-t42', ''
    ].join('\n'));
  });

  test('non-exec service injects image but keeps its real command (no idle lines)', () => {
    const yaml = renderOverride({
      service: { name: 'agent-harness-service', compose_service: 'app', mode: 'start' },
      slug: 't42',
      allocations: [{ host: 3100, internal: 8080 }],
      networkAlias: 'app-network',
      image: 'agent-harness-service-app'
    });
    assert.ok(yaml.includes('    image: agent-harness-service-app'));
    assert.ok(!yaml.includes('entrypoint'));
    assert.ok(!yaml.includes('command:'));
  });

  test('no image resolved: omit image lines but still idle an exec service', () => {
    const yaml = renderOverride({
      service: { name: 'jelou-api', compose_service: 'app', mode: 'exec' },
      slug: 't42',
      allocations: [{ host: 3100, internal: 8080 }],
      networkAlias: 'app-network',
      image: null
    });
    assert.ok(!yaml.includes('image:'));
    assert.ok(!yaml.includes('pull_policy'));
    assert.ok(yaml.includes('    entrypoint: ["sleep", "infinity"]'));
  });
});
