import type { Page, APIRequestContext } from '@playwright/test';

export async function signInAs(
  page: Page,
  request: APIRequestContext,
  email = 'pro@example.test',
): Promise<void> {
  await request.post('/api/test/seed', {
    data: { email, role: 'user', subscription_status: 'pro' },
  });
  const response = await request.post('/api/test/login', {
    data: { email, ttl_s: 3600 },
  });
  if (!response.ok()) {
    throw new Error(`signInAs: login failed (${response.status()}) for ${email}`);
  }
  const { token } = await response.json();
  await page.context().addCookies([
    { name: 'auth_token', value: token, url: 'http://localhost:4001' },
  ]);
}
