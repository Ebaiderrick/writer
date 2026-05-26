import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('settings billing renders with tighter plan layout', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    document.querySelector('.open-settings-btn')?.click();
  });
  await expect(page.locator('#settingsView')).toBeVisible();
  await page.getByRole('button', { name: 'Billing' }).click();
  await expect(page.locator('[data-settings-section="billing"].is-active')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/settings-billing-polish.png' });
});
