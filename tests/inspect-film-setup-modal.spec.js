import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('film setup modal layout renders with updated card polish', async ({ page }) => {
  await login(page);
  await page.locator('#newProjectBtn').click();
  await page.getByRole('button', { name: /Film Script/i }).click();
  await expect(page.locator('.creation-flow-detail')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/film-setup-polish.png' });
});
