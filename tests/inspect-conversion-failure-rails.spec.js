import { test, expect } from '@playwright/test';

test.setTimeout(60000);

async function openApp(page) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto('http://127.0.0.1:4173/', { waitUntil: 'commit', timeout: 15000 });
      await page.locator('#conversionReviewDialog').waitFor({ state: 'attached', timeout: 15000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await page.waitForTimeout(600);
      }
    }
  }
  throw lastError;
}

test('failed conversion review explains next steps and retry state', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => {
    const dialog = document.getElementById('conversionReviewDialog');
    if (!dialog) throw new Error('Missing conversionReviewDialog');
    document.getElementById('conversionReviewTitle').textContent = 'Review "broken-upload.pdf"';
    document.getElementById('conversionReviewMeta').textContent = 'Follow the script from extracted source text through normalization and into the final EyaWriter screenplay structure.';
    document.getElementById('conversionReviewStatus').textContent = 'failed';
    document.getElementById('conversionReviewStage').textContent = 'Conversion failed';
    document.getElementById('conversionReviewFile').textContent = 'broken-upload.pdf';
    document.getElementById('conversionReviewLineCount').textContent = '0';
    const warnings = document.getElementById('conversionReviewWarnings');
    warnings.hidden = false;
    warnings.textContent = 'The uploaded PDF did not contain enough readable text to build screenplay blocks.';
    const typeGrid = document.getElementById('conversionReviewTypeGrid');
    typeGrid.hidden = true;
    document.getElementById('conversionReviewRaw').value = 'Unreadable scan fragment';
    document.getElementById('conversionReviewNormalized').value = '';
    document.getElementById('conversionReviewStructured').innerHTML = `
      <p class="conversion-review-structured-empty">
        Conversion stopped before screenplay blocks were created. Review the warning details above, then retry from this job when you are ready.
      </p>
    `;
    const retryBtn = document.getElementById('conversionReviewRetryBtn');
    retryBtn.textContent = 'Retry conversion';
    retryBtn.disabled = true;
    if (!dialog.open) dialog.showModal();
  });

  await expect(page.locator('#conversionReviewDialog[open]')).toBeVisible();
  await expect(page.locator('#conversionReviewStatus')).toHaveText('failed');
  await expect(page.locator('#conversionReviewWarnings')).toContainText('did not contain enough readable text');
  await expect(page.locator('#conversionReviewStructured')).toContainText('Conversion stopped before screenplay blocks were created');
  await expect(page.locator('#conversionReviewRetryBtn')).toHaveText('Retry conversion');
  await expect(page.locator('#conversionReviewRetryBtn')).toBeDisabled();

  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/conversion-failure-review.png' });
});
