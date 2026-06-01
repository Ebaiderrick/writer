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

test('live conversion workspace shows progress, accepts edits, and reopens from format menu', async ({ page }) => {
  await page.route('**/api/convert-script', async (route) => {
    const payload = route.request().postDataJSON();
    const stageDelay = payload.stage === 'structure' ? 1800 : 350;
    await new Promise((resolve) => setTimeout(resolve, stageDelay));
    if (payload.stage === 'cover') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          coverPage: {
            title: 'LIVE CONVERSION SCRIPT',
            author: 'Ayo Writer',
            contact: 'ayo@example.com',
            company: 'Open Frame Pictures',
            details: 'Draft one',
            logline: 'A converted screenplay test.'
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
          text: 'INT. KITCHEN - DAY\n\nMARA\nThe wrapped dialogue should stay together.',
          coverPage: {
            title: 'LIVE CONVERSION SCRIPT',
            author: 'Ayo Writer',
            contact: 'ayo@example.com',
            company: 'Open Frame Pictures',
            details: 'Draft one',
            logline: 'A converted screenplay test.'
          },
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
          { type: 'scene', text: 'INT. KITCHEN - DAY' },
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
  await page.getByPlaceholder('Write script name').fill('Live Conversion Script');
  await page.locator('[data-creation-action="convert-import"]').click();
  await page.setInputFiles('#convertImportInput', {
    name: 'live-conversion.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('LIVE CONVERSION SCRIPT\nby Ayo Writer\nayo@example.com\nOpen Frame Pictures\n\nINT. KITCHEN - DAY\nMARA\nThe wrapped dialogue should stay together.')
  });

  await expect(page.locator('#conversionLiveDialog[open]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#conversionLiveStage')).toContainText(/Uploading|Extracting|Normalizing|Structuring/i, { timeout: 15000 });
  await expect(page.locator('.conversion-live-warning-card')).toContainText(/Recheck this data/i);
  await page.locator('#conversionLiveRaw').fill('LIVE CONVERSION SCRIPT\nby Ayo Writer\n\nINT. KITCHEN - DAY\nMARA\nThe wrapped dialogue should stay together.');
  await page.locator('#conversionLiveNormalized').fill('INT. KITCHEN - DAY\n\nMARA\nThe wrapped dialogue should stay together.');
  await expect(page.locator('#conversionLiveCoverTitle')).toHaveValue('LIVE CONVERSION SCRIPT');
  await expect(page.locator('#conversionLiveCoverAuthor')).toHaveValue('Ayo Writer');
  await page.locator('#conversionLiveCoverDetails').fill('Draft one');
  await page.locator('#conversionLiveSaveTextBtn').click();
  await expect(page.locator('#conversionLiveTextStatus')).toContainText(/Text edits saved/i);
  await page.locator('#conversionLiveGuidance').fill('Keep wrapped dialogue in a single block and preserve uppercase names as character cues.');
  await page.locator('#conversionLiveSaveGuidanceBtn').click();
  await expect(page.locator('#conversionLiveGuidanceStatus')).toContainText(/Guidance saved/i);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'live-conversion-workspace.png') });

  await expect(page.locator('#conversionReviewDialog[open]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#titleInput')).toHaveValue('LIVE CONVERSION SCRIPT');
  await expect(page.locator('#authorInput')).toHaveValue('Ayo Writer');
  await page.locator('#conversionReviewCloseBtn').click();
  if (await page.locator('#customModal[open]').isVisible().catch(() => false)) {
    await page.evaluate(() => document.getElementById('customModal')?.close());
  }

  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await page.evaluate(() => {
    const menu = document.getElementById('studioFormatMenu');
    if (menu) {
      menu.hidden = false;
      menu.style.display = 'block';
    }
    const button = document.getElementById('openConversionInterfaceMenuBtn');
    if (button) {
      button.hidden = false;
      button.disabled = false;
    }
  });
  await page.evaluate(() => {
    document.getElementById('openConversionInterfaceMenuBtn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.locator('#conversionLiveDialog[open]')).toBeVisible({ timeout: 15000 });
});
