import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('file recovery dialog renders with tighter compact cards', async ({ page }) => {
  await login(page);
  await page.evaluate(() => {
    const dialog = document.getElementById('fileRecoveryDialog');
    const empty = document.getElementById('fileRecoveryEmpty');
    const list = document.getElementById('fileRecoveryList');
    if (!dialog || !empty || !list) throw new Error('Missing file recovery dialog nodes');
    empty.hidden = true;
    list.hidden = false;
    list.innerHTML = `
      <article class="recovery-item" data-recovery-id="one">
        <div class="recovery-item-copy">
          <h4 class="recovery-item-title">The Hill at First Light</h4>
          <p class="recovery-item-meta">Deleted May 26, 2026, 10:48 PM</p>
        </div>
        <div class="recovery-item-actions">
          <button class="ghost-button btn-sm" type="button">Recover</button>
          <button class="ghost-button btn-sm recovery-delete-button" type="button">Delete</button>
        </div>
      </article>
      <article class="recovery-item" data-recovery-id="two">
        <div class="recovery-item-copy">
          <h4 class="recovery-item-title">Untitled Script</h4>
          <p class="recovery-item-meta">Deleted May 26, 2026, 9:17 PM</p>
        </div>
        <div class="recovery-item-actions">
          <button class="ghost-button btn-sm" type="button">Recover</button>
          <button class="ghost-button btn-sm recovery-delete-button" type="button">Delete</button>
        </div>
      </article>
    `;
    if (!dialog.open) dialog.showModal();
  });
  await expect(page.locator('#fileRecoveryDialog[open]')).toBeVisible();
  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/file-recovery-polish.png' });
});
