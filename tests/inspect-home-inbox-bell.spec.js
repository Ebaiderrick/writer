import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('home inbox bell uses the lighter landing-page notification style', async ({ page }) => {
  await login(page);

  await page.click('#homeInboxBellBtn');
  await expect(page.locator('#workspace-inbox-popup')).toHaveClass(/active/);

  await page.evaluate(() => {
    const badge = document.getElementById('homeInboxBellBadge');
    if (badge) {
      badge.hidden = false;
      badge.textContent = '3';
    }

    const popupList = document.getElementById('workspaceInboxPopupList');
    if (popupList) {
      popupList.classList.add('has-scroll');
      popupList.innerHTML = `
        <div class="workspace-inbox-popup-row workspace-notification-item workspace-inbox-popup-entry">
          <button class="workspace-inbox-popup-line is-unseen" type="button">
            <span class="workspace-notification-copy workspace-inbox-popup-line-main">
              <strong>Invite · War After the War Ends</strong>
              <small>Derrick invited you as Editor.</small>
            </span>
            <span class="workspace-inbox-popup-line-meta">Awaiting</span>
          </button>
          <button class="workspace-inbox-dismiss-btn" type="button" aria-label="Clear notification">&#10003;</button>
        </div>
        <div class="workspace-inbox-popup-row workspace-notification-item workspace-inbox-popup-entry">
          <button class="workspace-inbox-popup-line is-unseen workspace-notification-item-due" type="button">
            <span class="workspace-notification-copy workspace-inbox-popup-line-main">
              <strong>Task · Tighten opening dialogue</strong>
              <small>Scene-level task waiting in Untitled Script.</small>
            </span>
            <span class="workspace-inbox-popup-line-meta">Scene</span>
          </button>
          <button class="workspace-inbox-dismiss-btn" type="button" aria-label="Clear notification">&#10003;</button>
        </div>
        <div class="workspace-inbox-popup-row workspace-notification-item workspace-inbox-popup-entry">
          <button class="workspace-inbox-popup-line is-unseen" type="button">
            <span class="workspace-notification-copy workspace-inbox-popup-line-main">
              <strong>Comment · Ruiz feedback</strong>
              <small>A new note was left on the linked task.</small>
            </span>
            <span class="workspace-inbox-popup-line-meta">Line</span>
          </button>
          <button class="workspace-inbox-dismiss-btn" type="button" aria-label="Clear notification">&#10003;</button>
        </div>
      `;
    }
  });

  await expect(page.locator('.workspace-inbox-popup-card')).toBeVisible();
  await page.screenshot({ path: 'artifacts/home-inbox-bell-polish.png', fullPage: false });
});
