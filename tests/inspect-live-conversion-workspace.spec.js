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

test('live conversion workspace shows progress and accepts guidance', async ({ page }) => {
  await page.route('**/api/convert-script', async (route) => {
    const payload = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 450));
    if (payload.stage === 'normalize') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          text: 'INT. KITCHEN - DAY\n\nMARA\nThe wrapped dialogue should stay together.',
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
    buffer: Buffer.from('INT. KITCHEN - DAY\nMARA\nThe wrapped dialogue should stay together.')
  });

  await expect(page.locator('#conversionLiveDialog[open]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#conversionLiveStage')).toContainText(/Uploading|Extracting|Normalizing|Structuring/i, { timeout: 15000 });
  await page.locator('#conversionLiveGuidance').fill('Keep wrapped dialogue in a single block and preserve uppercase names as character cues.');
  await page.locator('#conversionLiveSaveGuidanceBtn').click();
  await expect(page.locator('#conversionLiveGuidanceStatus')).toContainText(/Guidance saved/i);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'live-conversion-workspace.png') });

  await expect(page.locator('#conversionReviewDialog[open]')).toBeVisible({ timeout: 30000 });
});
