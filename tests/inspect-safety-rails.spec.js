import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('failed conversion review gives clear recovery guidance', async ({ page }) => {
  await login(page);
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
    const stateCard = document.getElementById('conversionReviewStateCard');
    stateCard.dataset.stateTone = 'error';
    document.getElementById('conversionReviewStateTitle').textContent = 'This conversion stopped before the screenplay was built.';
    document.getElementById('conversionReviewStateBody').textContent = 'Read the warning details, inspect the extracted text, and retry when you are ready. If the source file is a scan or badly wrapped export, a cleaner PDF or DOCX will usually help.';
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
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/conversion-failure-review.png' });
});

test('empty conversion jobs explains the next step', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const dialog = document.getElementById('conversionJobsDialog');
    const empty = document.getElementById('conversionJobsEmpty');
    const list = document.getElementById('conversionJobsList');
    if (!dialog || !empty || !list) throw new Error('Missing conversion jobs dialog nodes');
    empty.hidden = false;
    list.hidden = true;
    list.innerHTML = '';
    if (!dialog.open) dialog.showModal();
  });
  await expect(page.locator('#conversionJobsDialog[open]')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/conversion-jobs-empty.png' });
});

test('empty file recovery gives a calm explanation', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const dialog = document.getElementById('fileRecoveryDialog');
    const empty = document.getElementById('fileRecoveryEmpty');
    const list = document.getElementById('fileRecoveryList');
    if (!dialog || !empty || !list) throw new Error('Missing file recovery dialog nodes');
    empty.hidden = false;
    list.hidden = true;
    list.innerHTML = '';
    if (!dialog.open) dialog.showModal();
  });
  await expect(page.locator('#fileRecoveryDialog[open]')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/file-recovery-empty.png' });
});
