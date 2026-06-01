import { test, expect } from '@playwright/test';
import path from 'node:path';

const ARTIFACTS_DIR = path.resolve('C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts');

async function loginToHome(page) {
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
  const demoLogin = page.locator('#demo-login-btn');
  if (await demoLogin.isVisible().catch(() => false)) {
    await demoLogin.click();
  }
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });
}

test('live conversion mid-scroll keeps only the main top pane frozen', async ({ page }) => {
  await page.route('**/api/convert-script', async (route) => {
    const payload = route.request().postDataJSON();
    if (payload.stage === 'cover') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          coverPage: {
            title: 'TST SCRIPT',
            author: 'EBAI Derrick',
            contact: '',
            company: '',
            details: '',
            logline: ''
          },
          warnings: []
        })
      });
      return;
    }
    if (payload.stage === 'normalize') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          text: `EXT. NCHANG VILLAGE STREET - MORNING

Camera shot from above from the village stream going into
the village of nchang. Till the split of the tarred road.
The camera continues on the tarred road and stops at
NKONGO's hut. The shot shows the beautiful wake of the sun
and the calm and serene village.

MARA
The wrapped dialogue should stay together.`,
          warnings: []
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        lines: [
          { type: 'scene', text: 'EXT. NCHANG VILLAGE STREET - MORNING' },
          { type: 'action', text: 'Camera shot from above from the village stream going into the village of nchang. Till the split of the tarred road. The camera continues on the tarred road and stops at NKONGO\'s hut. The shot shows the beautiful wake of the sun and the calm and serene village.' },
          { type: 'character', text: 'MARA' },
          { type: 'dialogue', text: 'The wrapped dialogue should stay together.' }
        ],
        warnings: []
      })
    });
  });

  await loginToHome(page);
  await page.locator('#newProjectBtn').click();
  await page.getByRole('button', { name: /Film Script/i }).click();
  await page.getByPlaceholder('Write script name').fill('Tst Script');
  await page.locator('[data-creation-action="convert-import"]').click();
  await page.setInputFiles('#convertImportInput', {
    name: 'tst-script.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('TST SCRIPT\nby EBAI Derrick\n\nEXT. NCHANG VILLAGE STREET - MORNING\nMARA\nThe wrapped dialogue should stay together.')
  });

  await expect(page.locator('#conversionLiveDialog[open]')).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    const sheet = document.querySelector('.conversion-live-sheet');
    if (sheet) {
      sheet.scrollTop = 420;
    }
  });

  await expect(page.locator('.conversion-live-head')).toBeVisible();
  const panelHeadPosition = await page.locator('.conversion-live-panel-head').nth(1).evaluate((node) => getComputedStyle(node).position);
  expect(panelHeadPosition).toBe('relative');

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'live-conversion-midscroll.png') });
});
