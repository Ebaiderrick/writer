import path from 'path';
import { test, expect } from '@playwright/test';
import { login } from './helper.js';

const ARTIFACTS_DIR = 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts';

test('team assembly popup uses the calmer workspace interface family', async ({ page }) => {
  await login(page);

  await page.evaluate(() => {
    const menu = document.getElementById('studioToolsMenu');
    if (menu) {
      menu.hidden = false;
      menu.style.display = 'block';
    }
    const button = document.querySelector('#studioToolsMenu [data-menu-action="open-workspace"]');
    if (button) {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });

  await expect(page.locator('.workspace-popup')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'team-assembly-polish.png') });
});
