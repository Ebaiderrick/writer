import { test, expect } from '@playwright/test';
import { login } from './helper.js';

async function openFilmCreationFlow(page) {
  await page.click('#newProjectBtn');
  await page.getByRole('button', { name: /Film Script/i }).click();
  await expect(page.getByRole('heading', { name: /Name your script/i })).toBeVisible();
}

test('new film script start-new path creates a named project', async ({ page }) => {
  await login(page);
  await openFilmCreationFlow(page);

  await page.getByPlaceholder('Write script name').fill('Local Start Script');
  await page.getByRole('button', { name: 'OK' }).click();

  await expect(page.locator('#studioView')).toBeVisible();
  await expect(page.locator('#titleInput')).toHaveValue('Local Start Script');
  await expect(page.locator('#goHomeBtn')).toBeVisible();
});

test('new film script import path keeps the chosen title and imports text', async ({ page }) => {
  test.setTimeout(60000);
  await login(page);
  await openFilmCreationFlow(page);

  await page.getByPlaceholder('Write script name').fill('Local Import Script');
  await page.locator('[data-creation-action="import"]').click();
  await page.setInputFiles('#fileInput', {
    name: 'sample-script.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('INT. ROOM - DAY\nA quiet room waits.\nMARA\nWe are inside the import flow.')
  });

  await expect(page.locator('#studioView')).toBeVisible();
  await expect(page.locator('#titleInput')).toHaveValue('Local Import Script');
  await expect(page.locator('.script-block').first()).toContainText('INT. ROOM - DAY');
  await expect(page.locator('#screenplayEditor').getByText('We are inside the import flow.')).toBeVisible();
});

test('new film script convert-and-import path shows the chosen title and imports converted text', async ({ page }) => {
  test.setTimeout(60000);
  await login(page);
  await openFilmCreationFlow(page);

  await page.getByPlaceholder('Write script name').fill('Local Convert Script');
  await page.locator('[data-creation-action="convert-import"]').click();

  await page.setInputFiles('#convertImportInput', {
    name: 'convert-source.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('INT. KITCHEN - DAY\nA kettle screams on the stove.\nMARA\nThis is the conversion path.')
  });

  await expect(page.locator('#studioView')).toBeVisible();
  await expect(page.locator('#titleInput')).toHaveValue('Local Convert Script');
  await expect(page.locator('#screenplayEditor').getByText('INT. KITCHEN - DAY')).toBeVisible();
  await expect(page.locator('#screenplayEditor').getByText('This is the conversion path.')).toBeVisible();
});
