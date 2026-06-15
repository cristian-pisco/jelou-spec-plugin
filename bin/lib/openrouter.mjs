// bin/lib/openrouter.mjs
//
// One transport-level OpenRouter chat/completions POST. Returns a result object
// rather than throwing, so callers build their own envelopes. Shared by
// bin/council.mjs (judge verdicts) and bin/investigate.mjs (Fusion answers).

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api';

export async function chatCompletion({
  model,
  prompt,
  apiKey,
  baseUrl = OPENROUTER_BASE_URL,
  timeoutMs,
  maxTokens,
  dataCollection = 'deny',
  responseFormat = null,
  fetchImpl = fetch,
}) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    provider: { data_collection: dataCollection },
  };
  if (responseFormat) body.response_format = responseFormat;

  let res;
  try {
    res = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = /abort|timeout/i.test(String(err?.name || err));
    return { ok: false, timedOut, error: String(err?.message || err) };
  }

  if (!res.ok) {
    return { ok: false, httpStatus: res.status, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
  }

  const json = await res.json().catch(() => null);
  const content = json?.choices?.[0]?.message?.content ?? '';
  return { ok: true, httpStatus: res.status, content, json };
}
