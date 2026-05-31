import { test, expect } from '@playwright/test';
import path from 'node:path';
import { login } from './helper.js';

const ARTIFACTS_DIR = path.resolve('C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts');
const DOCX_FIXTURE = path.resolve('C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/tests/fixtures/sample-screenplay.docx');
const PDF_FIXTURE = path.resolve('C:/Users/NKEDE GEOR/Desktop/tst script.pdf');

async function openFilmSetup(page) {
  await page.click('#newProjectBtn');
  await page.getByRole('button', { name: /Film Script/i }).click();
  await expect(page.getByRole('heading', { name: /Name your script/i })).toBeVisible();
}

async function beginConvertImport(page, projectName, filePath) {
  await openFilmSetup(page);
  await page.getByPlaceholder('Write script name').fill(projectName);
  await page.locator('[data-creation-action="convert-import"]').click();
  await page.setInputFiles('#convertImportInput', filePath);
}

test('task 1 convert and import shows staged progress and review for docx', async ({ page }) => {
  test.setTimeout(120000);
  await login(page);
  await beginConvertImport(page, 'DOCX Convert Script', DOCX_FIXTURE);

  await expect(page.locator('.app-toast').filter({ hasText: /Uploading source file|Uploading your script/i }).first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'task1-convert-progress-docx.png') });

  await expect(page.locator('#conversionReviewDialog')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#conversionReviewStructured')).toContainText('INT. KITCHEN - DAY');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'task1-convert-review-docx.png') });

  await page.getByRole('button', { name: /Close/i }).click();
  await expect(page.locator('#studioView')).toBeVisible();
  await expect(page.locator('#titleInput')).toHaveValue('DOCX Convert Script');
  await expect(page.locator('#screenplayEditor')).toContainText('INT. KITCHEN - DAY');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'task1-convert-result-docx.png') });
});

test('task 1 convert and import creates a reviewable job for pdf', async ({ page }) => {
  test.setTimeout(180000);
  await login(page);
  await beginConvertImport(page, 'PDF Convert Script', PDF_FIXTURE);

  await expect(page.locator('.app-toast').filter({ hasText: /Extracting text from PDF|Reading PDF page|Normalizing screenplay text|Structuring screenplay blocks/i }).first()).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'task1-convert-progress-pdf.png') });

  await expect(page.locator('#conversionReviewDialog')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('#conversionReviewFile')).toContainText('tst script.pdf');
  await expect(page.locator('#conversionReviewRaw')).not.toHaveValue('');
  await expect(page.locator('#conversionReviewStructured')).not.toContainText('No structured screenplay lines are stored');
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'task1-convert-review-pdf.png') });
});
