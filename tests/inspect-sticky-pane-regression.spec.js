import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('sticky work panes keep solid headers across the main workspaces', async ({ page }) => {
  await login(page);

  const styles = await page.evaluate(() => {
    const open = (id) => {
      const dialog = document.getElementById(id);
      if (dialog && !dialog.open) dialog.showModal();
    };

    open('conversionJobsDialog');
    open('conversionReviewDialog');
    open('fileRecoveryDialog');
    document.querySelector('.open-settings-btn')?.click();

    const read = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = window.getComputedStyle(node);
      return {
        position: style.position,
        backgroundColor: style.backgroundColor,
        borderBottomStyle: style.borderBottomStyle
      };
    };

    return {
      jobs: read('.conversion-jobs-head'),
      review: read('.conversion-review-head'),
      recovery: read('.file-recovery-head'),
      settings: read('.settings-section.is-active .settings-section-inner h2')
    };
  });

  for (const key of ['jobs', 'review', 'recovery', 'settings']) {
    expect(styles[key]).not.toBeNull();
    expect(styles[key].position).toBe('sticky');
    expect(styles[key].backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(styles[key].borderBottomStyle).toBe('solid');
  }
});
