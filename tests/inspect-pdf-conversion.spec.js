import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('inspect real pdf conversion output', async ({ page }) => {
  test.setTimeout(180000);

  await login(page);
  await page.click('#newProjectBtn');
  await page.getByRole('button', { name: /Film Script/i }).click();
  await page.getByPlaceholder('Write script name').fill('PDF Inspect Script');
  await page.locator('[data-creation-action="convert-import"]').click();

  await page.setInputFiles('#convertImportInput', 'C:\\Users\\NKEDE GEOR\\Desktop\\tst script.pdf');

  await page.waitForTimeout(5000);

  const toasts = await page.locator('#toastHost .app-toast-message').allTextContents().catch(() => []);
  const modalTitle = await page.locator('#modalTitle').textContent().catch(() => '');
  const modalMessage = await page.locator('#modalMessage').textContent().catch(() => '');
  const pendingRows = await page.locator('#screenplayEditor .script-block-row').count();

  await expect(page.locator('#studioView')).toBeVisible({ timeout: 120000 });
  await expect(page.locator('#titleInput')).toHaveValue('PDF Inspect Script');

  const rows = await page.locator('#screenplayEditor .script-block-row').evaluateAll((nodes) => {
    return nodes.slice(0, 40).map((row) => ({
      type: row.getAttribute('data-type'),
      text: (row.querySelector('.script-block')?.textContent || '').trim()
    }));
  });

  console.log('PDF_TOASTS', JSON.stringify(toasts));
  console.log('PDF_MODAL_TITLE', modalTitle || '');
  console.log('PDF_MODAL_MESSAGE', modalMessage || '');
  console.log('PDF_ROW_COUNT', pendingRows);
  console.log('PDF_CONVERSION_ROWS_START');
  rows.forEach((row, index) => {
    console.log(`${index + 1}. [${row.type}] ${row.text}`);
  });
  console.log('PDF_CONVERSION_ROWS_END');
});
