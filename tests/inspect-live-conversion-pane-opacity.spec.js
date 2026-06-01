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

test('live conversion top pane is solid and non-transparent', async ({ page }) => {
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
          text: 'EXT. NCHANG VILLAGE STREET - MORNING\n\nNKONGO\nThe camera continues on the tarred road and stops at NKONGO\'s hut.',
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
          { type: 'character', text: 'NKONGO' },
          { type: 'dialogue', text: "The camera continues on the tarred road and stops at NKONGO's hut." }
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
    buffer: Buffer.from('TST SCRIPT\nby EBAI Derrick\n\nEXT. NCHANG VILLAGE STREET - MORNING\nNKONGO\nThe camera continues on the tarred road and stops at NKONGO\'s hut.')
  });

  await expect(page.locator('#conversionLiveDialog[open]')).toBeVisible({ timeout: 15000 });
  const shell = page.locator('.conversion-live-sheet');
  const head = page.locator('.conversion-live-head');
  const panelHead = page.locator('.conversion-live-panel-head').nth(1);

  const shellBg = await shell.evaluate((node) => getComputedStyle(node).backgroundColor);
  const headBg = await head.evaluate((node) => getComputedStyle(node).backgroundColor);
  const panelHeadBg = await panelHead.evaluate((node) => getComputedStyle(node).backgroundColor);

  expect(shellBg).not.toBe('rgba(0, 0, 0, 0)');
  expect(headBg).not.toBe('rgba(0, 0, 0, 0)');
  expect(panelHeadBg).not.toBe('rgba(0, 0, 0, 0)');

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'live-conversion-pane-opacity.png') });
});
