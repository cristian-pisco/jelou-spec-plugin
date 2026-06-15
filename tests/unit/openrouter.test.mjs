// tests/unit/openrouter.test.mjs
import { test, describe, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { chatCompletion } from '../../bin/lib/openrouter.mjs';

describe('chatCompletion against a mocked OpenRouter', () => {
  let server;
  let baseUrl;

  const start = () =>
    new Promise((resolve) => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const { model } = JSON.parse(body);
          if (model === 'ok') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      content: 'answer text',
                      annotations: [
                        { type: 'url_citation', url_citation: { title: 'Doc', url: 'https://x.test' } },
                      ],
                    },
                  },
                ],
              }),
            );
          } else if (model === 'rate-limited') {
            res.writeHead(429, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'rate limited' } }));
          } else if (model === 'slow') {
            // never responds — exercises the AbortSignal timeout
          }
        });
      });
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

  after(() => server?.close());

  test('200 returns ok with content and parsed json', async () => {
    await start();
    const r = await chatCompletion({ model: 'ok', prompt: 'p', apiKey: 'k', baseUrl, timeoutMs: 5000, maxTokens: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.content, 'answer text');
    assert.equal(r.json.choices[0].message.annotations[0].url_citation.url, 'https://x.test');
  });

  test('non-2xx returns ok:false with httpStatus', async () => {
    const r = await chatCompletion({ model: 'rate-limited', prompt: 'p', apiKey: 'k', baseUrl, timeoutMs: 5000, maxTokens: 100 });
    assert.equal(r.ok, false);
    assert.equal(r.httpStatus, 429);
  });

  test('timeout returns ok:false with timedOut', async () => {
    const r = await chatCompletion({ model: 'slow', prompt: 'p', apiKey: 'k', baseUrl, timeoutMs: 150, maxTokens: 100 });
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
  });
});
