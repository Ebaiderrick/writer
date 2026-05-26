import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('conversion review renders as a polished workspace', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const dialog = document.getElementById('conversionReviewDialog');
    if (!dialog) throw new Error('Missing conversionReviewDialog');
    document.getElementById('conversionReviewTitle').textContent = 'Review "tst script.pdf"';
    document.getElementById('conversionReviewMeta').textContent = 'Follow the script from extracted source text through normalization and into the final EyaWriter screenplay structure.';
    document.getElementById('conversionReviewStatus').textContent = 'Completed';
    document.getElementById('conversionReviewStage').textContent = 'Structured screenplay blocks';
    document.getElementById('conversionReviewFile').textContent = 'tst script.pdf';
    document.getElementById('conversionReviewLineCount').textContent = '148';
    const warnings = document.getElementById('conversionReviewWarnings');
    warnings.hidden = false;
    warnings.textContent = 'A few dialogue wraps were merged during normalization. Review character-to-dialogue pairing before final export.';
    const typeGrid = document.getElementById('conversionReviewTypeGrid');
    typeGrid.hidden = false;
    typeGrid.innerHTML = `
      <div class="conversion-review-type-pill"><span>action</span><strong>57</strong></div>
      <div class="conversion-review-type-pill"><span>dialogue</span><strong>42</strong></div>
      <div class="conversion-review-type-pill"><span>character</span><strong>24</strong></div>
      <div class="conversion-review-type-pill"><span>scene</span><strong>15</strong></div>
    `;
    document.getElementById('conversionReviewRaw').value = 'INT. NEWSROOM - DAY\\n\\nPhones ring across the room.\\n\\nMARA\\nI thought the draft was due at noon.';
    document.getElementById('conversionReviewNormalized').value = 'INT. NEWSROOM - DAY\\n\\nPhones ring across the room. Mara crosses between crowded desks.\\n\\nMARA\\nI thought the draft was due at noon.';
    document.getElementById('conversionReviewStructured').innerHTML = `
      <div class="conversion-review-line">
        <span class="conversion-review-line-type">scene</span>
        <div class="conversion-review-line-text">INT. NEWSROOM - DAY</div>
      </div>
      <div class="conversion-review-line">
        <span class="conversion-review-line-type">action</span>
        <div class="conversion-review-line-text">Phones ring across the room. Mara crosses between crowded desks.</div>
      </div>
      <div class="conversion-review-line">
        <span class="conversion-review-line-type">character</span>
        <div class="conversion-review-line-text">MARA</div>
      </div>
      <div class="conversion-review-line">
        <span class="conversion-review-line-type">dialogue</span>
        <div class="conversion-review-line-text">I thought the draft was due at noon.</div>
      </div>
    `;
    if (!dialog.open) dialog.showModal();
  });
  await expect(page.locator('#conversionReviewDialog[open]')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/conversion-review-polish.png' });
});
