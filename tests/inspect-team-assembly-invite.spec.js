import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('team assembly invite controls dispatch invite actions', async ({ page }) => {
  await login(page);

  await page.evaluate(() => {
    const events = [];
    window.__inviteEvents = events;
    window.addEventListener('workspaceInviteRequested', (event) => {
      events.push({
        email: event.detail?.email || '',
        role: event.detail?.role || ''
      });
    });

    const menu = document.getElementById('studioToolsMenu');
    if (menu) {
      menu.hidden = false;
      menu.style.display = 'block';
    }
    const button = document.querySelector('#studioToolsMenu [data-menu-action="open-workspace"]');
    if (button) {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });

  await expect(page.locator('.workspace-popup')).toBeVisible({ timeout: 15000 });
  await page.locator('#workspaceInviteEmail').fill('collaborator@example.com');
  await page.locator('#workspaceInviteRole').selectOption('viewer');
  await page.locator('[data-workspace-action="invite"]').click();

  await expect.poll(async () => page.evaluate(() => window.__inviteEvents?.length || 0)).toBe(1);
  await expect.poll(async () => page.evaluate(() => window.__inviteEvents?.[0] || null)).toEqual({
    email: 'collaborator@example.com',
    role: 'viewer'
  });
});
