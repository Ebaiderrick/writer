import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('settings support shows conversion jobs shortcut and polished layout', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    document.querySelector('.open-settings-btn')?.click();
  });
  await expect(page.locator('#settingsView')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/settings-polish-general.png' });

  await page.getByRole('button', { name: 'Support' }).click();
  await expect(page.locator('[data-settings-section="support"].is-active')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/settings-polish-support.png' });

  await page.locator('#settingsConversionJobsBtn').click();
  await expect(page.locator('#conversionJobsDialog[open]')).toBeVisible();
});
