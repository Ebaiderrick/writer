import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('conversion jobs renders as a polished history view', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const empty = document.getElementById('conversionJobsEmpty');
    const list = document.getElementById('conversionJobsList');
    const dialog = document.getElementById('conversionJobsDialog');
    if (!empty || !list || !dialog) throw new Error('Missing conversion jobs dialog nodes');
    empty.hidden = true;
    list.hidden = false;
    list.innerHTML = `
      <button class="conversion-job-item" type="button" data-conversion-job-id="job-complete" data-conversion-job-status="completed">
        <span class="conversion-job-item-rail" aria-hidden="true"></span>
        <div class="conversion-job-item-main">
          <div class="conversion-job-item-top">
            <div>
              <h4 class="conversion-job-item-title">tst script.pdf</h4>
              <p class="conversion-job-item-meta">Updated May 26, 2026, 9:18 PM</p>
            </div>
            <span class="conversion-job-item-status">completed</span>
          </div>
          <p class="conversion-job-item-stage">Structured screenplay blocks</p>
          <div class="conversion-job-item-grid">
            <div><span>Project</span><strong>The Hill at First Light</strong></div>
            <div><span>Structured lines</span><strong>148</strong></div>
            <div><span>Warnings</span><strong>1</strong></div>
          </div>
        </div>
      </button>
      <button class="conversion-job-item" type="button" data-conversion-job-id="job-processing" data-conversion-job-status="processing">
        <span class="conversion-job-item-rail" aria-hidden="true"></span>
        <div class="conversion-job-item-main">
          <div class="conversion-job-item-top">
            <div>
              <h4 class="conversion-job-item-title">pilot-draft.docx</h4>
              <p class="conversion-job-item-meta">Updated May 26, 2026, 9:24 PM</p>
            </div>
            <span class="conversion-job-item-status">processing</span>
          </div>
          <p class="conversion-job-item-stage">Normalizing screenplay text</p>
          <div class="conversion-job-item-grid">
            <div><span>Project</span><strong>Untitled Script</strong></div>
            <div><span>Structured lines</span><strong>0</strong></div>
            <div><span>Warnings</span><strong>0</strong></div>
          </div>
        </div>
      </button>
      <button class="conversion-job-item" type="button" data-conversion-job-id="job-failed" data-conversion-job-status="failed">
        <span class="conversion-job-item-rail" aria-hidden="true"></span>
        <div class="conversion-job-item-main">
          <div class="conversion-job-item-top">
            <div>
              <h4 class="conversion-job-item-title">archive-scan.pdf</h4>
              <p class="conversion-job-item-meta">Updated May 26, 2026, 9:31 PM</p>
            </div>
            <span class="conversion-job-item-status">failed</span>
          </div>
          <p class="conversion-job-item-stage">Extracting readable text</p>
          <div class="conversion-job-item-grid">
            <div><span>Project</span><strong>Not linked</strong></div>
            <div><span>Structured lines</span><strong>0</strong></div>
            <div><span>Warnings</span><strong>2</strong></div>
          </div>
        </div>
      </button>
    `;
    if (!dialog.open) dialog.showModal();
  });
  await expect(page.locator('#conversionJobsDialog[open]')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/conversion-jobs-polish.png' });
});
