import { test, expect } from '@playwright/test';
import path from 'node:path';

const ARTIFACTS_DIR = path.resolve('C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts');

async function gotoWithRetry(page, url) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await page.waitForTimeout(750);
      }
    }
  }
  throw lastError;
}

async function loginViaDemoUi(page) {
  await gotoWithRetry(page, 'http://127.0.0.1:4173/');
  const demoLogin = page.locator('#demo-login-btn');
  if (await demoLogin.isVisible().catch(() => false)) {
    await demoLogin.click();
  }
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });
}

async function dismissBlockingDialogs(page) {
  if (await page.locator('#customModal[open]').isVisible().catch(() => false)) {
    await page.evaluate(() => document.getElementById('customModal')?.close());
  }
  if (await page.locator('#conversionReviewDialog[open]').isVisible().catch(() => false)) {
    await page.locator('#conversionReviewCloseBtn').click().catch(() => {});
    if (await page.locator('#conversionReviewDialog[open]').isVisible().catch(() => false)) {
      await page.evaluate(() => document.getElementById('conversionReviewDialog')?.close());
    }
  }
  if (await page.locator('#conversionJobsDialog[open]').isVisible().catch(() => false)) {
    await page.locator('#conversionJobsCloseBtn').click().catch(() => {});
  }
}

async function openFilmCreationFlow(page, name) {
  await page.locator('#newProjectBtn').click();
  await page.getByRole('button', { name: /Film Script/i }).click();
  await expect(page.getByRole('heading', { name: /Name your script/i })).toBeVisible();
  await page.getByPlaceholder('Write script name').fill(name);
}

test('journey: sign in lands on home', async ({ page }) => {
  await loginViaDemoUi(page);
  await expect(page.locator('#newProjectBtn')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'journey-sign-in-home.png') });
});

test('journey: create, write, and save home', async ({ page }) => {
  await loginViaDemoUi(page);
  await openFilmCreationFlow(page, 'Journey Write Script');
  await page.locator('[data-creation-action="start-new"]').click();

  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await dismissBlockingDialogs(page);
  const firstBlock = page.locator('#screenplayEditor .script-block[contenteditable="true"]').first();
  await firstBlock.click();
  await page.keyboard.type('INT. OFFICE - DAY');
  await expect(page.locator('#screenplayEditor')).toContainText('INT. OFFICE - DAY');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'journey-write-editor.png') });

  await page.locator('#goHomeBtn').click();
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'journey-save-home.png') });
});

test('journey: workspace, recovery, and settings are reachable', async ({ page }) => {
  await loginViaDemoUi(page);
  await openFilmCreationFlow(page, 'Journey Workspace Script');
  await page.locator('[data-creation-action="start-new"]').click();
  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await dismissBlockingDialogs(page);

  await page.getByRole('button', { name: 'Tools', exact: true }).click();
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
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'journey-workspace-popup.png') });
  await page.evaluate(() => document.getElementById('customModal')?.close());

  await page.locator('#goHomeBtn').click();
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });

  await page.locator('[data-open-workspace-id]').first().click();
  await expect(page.locator('#workspaceView')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'journey-workspace-dashboard.png') });

  await page.evaluate(() => {
    document.querySelectorAll('.app-toast').forEach((toast) => toast.remove());
  });
  await page.locator('#workspaceCloseBtn').click();
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.evaluate(() => {
    const menu = document.getElementById('homeFileMenu');
    if (menu) {
      menu.hidden = false;
      menu.style.display = 'block';
    }
  });
  await page.locator('#homeFileMenu [data-menu-action="open-file-recovery"]').click();
  await expect(page.locator('#fileRecoveryDialog[open]')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'journey-file-recovery.png') });
  await page.locator('#fileRecoveryCloseBtn').click();

  await page.locator('.open-profile-btn').first().click();
  await page.locator('#open-settings-btn').click();
  await expect(page.locator('#settingsView')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'journey-settings.png') });
});

test('journey: convert and import reaches jobs and review', async ({ page }) => {
  await page.route('**/api/convert-script', async (route) => {
    const payload = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (payload.stage === 'normalize') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          text: 'INT. KITCHEN - DAY\n\nMARA\nWe finally made it through conversion.',
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
          { type: 'dialogue', text: 'We finally made it through conversion.' }
        ],
        warnings: []
      })
    });
  });

  await loginViaDemoUi(page);
  await openFilmCreationFlow(page, 'Journey Convert Script');
  await page.locator('[data-creation-action="convert-import"]').click();
  await page.setInputFiles('#convertImportInput', {
    name: 'journey-convert.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('INT. KITCHEN - DAY\nMARA\nWe finally made it through conversion.')
  });

  await expect(page.locator('.app-toast').filter({ hasText: /Uploading|Extracting|Normalizing|Structuring|Importing/i }).first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'journey-conversion-progress.png') });

  await expect(page.locator('#screenplayEditor')).toContainText('We finally made it through conversion.', { timeout: 30000 });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'journey-conversion-editor.png') });
  await expect(page.locator('#conversionReviewDialog[open]')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'journey-conversion-review.png') });
  await dismissBlockingDialogs(page);

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.evaluate(() => {
    const menu = document.getElementById('studioFileMenu');
    if (menu) menu.hidden = false;
  });
  await page.locator('#studioFileMenu [data-menu-action="open-conversion-jobs"]').first().click();
  await expect(page.locator('#conversionJobsDialog[open]')).toBeVisible();
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'journey-conversion-jobs.png') });
});
