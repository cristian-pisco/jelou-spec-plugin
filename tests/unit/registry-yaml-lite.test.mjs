// tests/unit/registry-yaml-lite.test.mjs
//
// Run: `node --test tests/unit/registry-yaml-lite.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseYamlLite } from '../../bin/lib/registry/yaml-lite.mjs';

describe('parseYamlLite', () => {
  test('nested maps + scalars + flow lists', () => {
    const y = [
      'base_port: 3100',
      'compose_network_alias: app-network',
      'services:',
      '  jelou-api:',
      '    path: ../jelou-api',
      '    depends_on: [chatbot-server, redis]',
      '    dev:',
      '      launcher: docker-exec',
      '      port_env: APP_PORT',
      '      extra_ports: [SUPERVISOR_PORT]'
    ].join('\n');
    assert.deepEqual(parseYamlLite(y), {
      base_port: 3100,
      compose_network_alias: 'app-network',
      services: {
        'jelou-api': {
          path: '../jelou-api',
          depends_on: ['chatbot-server', 'redis'],
          dev: { launcher: 'docker-exec', port_env: 'APP_PORT', extra_ports: ['SUPERVISOR_PORT'] }
        }
      }
    });
  });

  test('quoted strings, bool, null, empty flow list, comments', () => {
    const y = [
      '# top comment',
      'a: "with: colon"   # trailing',
      "b: 'single'",
      'c: true',
      'd: ~',
      'e: []',
      'f:'
    ].join('\n');
    assert.deepEqual(parseYamlLite(y), { a: 'with: colon', b: 'single', c: true, d: null, e: [], f: null });
  });

  test('deep nesting (auth-style)', () => {
    const y = [
      'auth:',
      '  cookieName: jelou_auth',
      '  verify:',
      '    jelou-api: /v1/company',
      '    dashboard-server: /api/v1/auth/me',
      '  otpFallback:',
      '    redisContainer: redis',
      '    keyPrefix: "2fa-code-"'
    ].join('\n');
    assert.deepEqual(parseYamlLite(y), {
      auth: {
        cookieName: 'jelou_auth',
        verify: { 'jelou-api': '/v1/company', 'dashboard-server': '/api/v1/auth/me' },
        otpFallback: { redisContainer: 'redis', keyPrefix: '2fa-code-' }
      }
    });
  });
});
