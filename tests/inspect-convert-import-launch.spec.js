import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('convert and import opens file chooser before entering editor', async ({ page }) => {
  await login(page);

  await page.getByRole('button', { name: 'New Project' }).click();
  await page.getByRole('button', { name: /film script/i }).click();
  await page.getByPlaceholder('Write script name').fill('Convert Import Launch Test');

  const editorBefore = page.locator('#studioView');
  await expect(editorBefore).toBeHidden();

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: /convert & import/i }).click()
  ]);

  expect(chooser).toBeTruthy();
  await expect(page.locator('#studioView')).toBeHidden();
  await expect(page.locator('#homeView')).toBeVisible();
});
