import { test, expect } from '@playwright/test';

test('static server serves the compiled app shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('DSA5 Heldengenerator');
  await expect(page.locator('#status')).toHaveText('bereit');
});
