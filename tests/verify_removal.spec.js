import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('verify load sample button is removed', async ({ page }) => {
  await login(page);

  // Wait for the home view to be visible
  await page.waitForSelector('#homeView:not([hidden])');

  // Wait for project cards to appear
  await page.waitForSelector('.project-card');

  await page.screenshot({ path: 'home_view.png' });

  // Open the first project
  await page.click('.project-card-open', { force: true });

  // Wait for studio view
  await page.waitForSelector('#studioView:not([hidden])');

  // The button should not exist
  const loadSampleBtn = page.locator('#loadSampleBtn');
  await expect(loadSampleBtn).not.toBeVisible();

  // Also verify it's not in the DOM at all
  const count = await loadSampleBtn.count();
  expect(count).toBe(0);

  await page.screenshot({ path: 'verify_removal.png' });
});
