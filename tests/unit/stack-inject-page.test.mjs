// tests/unit/stack-inject-page.test.mjs
//
// Run: `node --test tests/unit/stack-inject-page.test.mjs`

import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { renderInjectPage } from '../../bin/lib/dev-orchestrator/stack/inject-page.mjs';

describe('renderInjectPage', () => {
  test('embeds the cookie set + redirect for localhost', () => {
    const html = renderInjectPage({ cookieName: 'jelou_auth', cookieValue: 'v!"1', appUrl: 'http://localhost:15175/home', account: 'e@x' });
    assert.ok(html.includes('document.cookie = "jelou_auth=" + "v!\\"1"'));
    assert.ok(html.includes('; path=/; max-age=604800; SameSite=Lax'));
    assert.ok(html.includes('location.replace("http://localhost:15175/home")'));
    assert.ok(html.includes('e@x'));
  });
});
