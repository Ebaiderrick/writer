import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('tablet studio file menu stays above the function strip', async ({ page }) => {
  await page.setViewportSize({ width: 1183, height: 694 });
  await login(page);

  await page.locator('#newProjectBtn').click();
  await page.getByRole('button', { name: /Film Script/i }).click();
  await page.locator('.creation-name-input').fill('Tablet Menu Check');
  await page.getByRole('button', { name: /^OK$/ }).click();

  await expect(page.locator('#studioView')).toBeVisible();
  await page.evaluate(() => {
    const menu = document.getElementById('studioFileMenu');
    const trigger = document.querySelector('.studio-nav [data-menu-trigger="studioFileMenu"]');
    if (menu) menu.hidden = false;
    if (trigger) trigger.classList.add('is-open');
  });
  await expect(page.locator('#studioFileMenu')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/tablet-file-menu-front.png' });
});
