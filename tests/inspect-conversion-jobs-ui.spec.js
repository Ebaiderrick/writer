import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('conversion jobs surfaces are reachable in app UI', async ({ page }) => {
  await login(page);

  await page.evaluate(() => {
    const menu = document.getElementById('homeFileMenu');
    if (menu) menu.hidden = false;
  });
  await expect(page.locator('#homeFileMenu [data-menu-action="open-conversion-jobs"]')).toBeVisible();
  await page.locator('#homeFileMenu [data-menu-action="open-conversion-jobs"]').click();

  await expect(page.locator('#conversionJobsDialog')).toBeVisible();
  await expect(page.locator('#conversionJobsEmpty')).toBeVisible();

  await page.locator('#conversionJobsCloseBtn').click();
  await expect(page.locator('#conversionJobsDialog')).not.toBeVisible();
});
