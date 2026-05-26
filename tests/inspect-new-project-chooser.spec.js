import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('new project chooser renders with polished first-step layout', async ({ page }) => {
  await login(page);
  await page.locator('#newProjectBtn').click();
  await expect(page.locator('.creation-flow-grid')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/new-project-chooser-polish.png' });
});
