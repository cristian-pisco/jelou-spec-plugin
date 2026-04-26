import { test, expect } from '@playwright/test';
import { signInAs } from './fixtures/auth';

test('cancels pro subscription and shows downgrade banner', async ({ page, request }) => {
  await signInAs(page, request, 'pro@example.test');

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel subscription' }).click();
  await expect(page.getByRole('status')).toHaveText('Your plan was downgraded to Free.');
});
