import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('verify load sample button is removed from DOM', async ({ page }) => {
  await login(page);

  // The button should not exist in the DOM anywhere
  const loadSampleBtn = page.locator('#loadSampleBtn');
  const count = await loadSampleBtn.count();
  expect(count).toBe(0);

  await page.screenshot({ path: 'verify_removal_dom.png' });
});
