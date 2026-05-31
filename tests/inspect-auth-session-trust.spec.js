import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('session restore keeps the app on home after reload', async ({ page }) => {
  await login(page);

  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#authView')).toBeHidden();
  await expect(page.locator('.open-profile-btn').first()).toBeVisible();

  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/auth-session-home.png' });
});

test('settings route restores into settings for a signed-in session', async ({ page }) => {
  await login(page);

  await page.goto('http://127.0.0.1:4173/settings', { waitUntil: 'domcontentloaded', timeout: 45000 });

  await expect(page.locator('#settingsView')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#settingsView [data-settings-tab="general"]')).toHaveClass(/is-active/);

  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/auth-session-settings-route.png' });
});

test('marketing help page swaps signup CTA to Home for signed-in users', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('eyawriter_session', JSON.stringify({
      userId: 'user_test',
      email: 'test@example.com',
      name: 'Tester',
      fullName: 'Tester',
      loggedIn: true,
      isDemoSession: true,
      loggedInAt: new Date().toISOString()
    }));
    localStorage.setItem('eyawriter-theme', 'navy');
  });

  await page.goto('http://127.0.0.1:4173/help.html', { waitUntil: 'domcontentloaded', timeout: 45000 });

  await expect(page.locator('.nav-actions .btn-ghost')).toBeHidden();
  await expect(page.locator('.nav-actions .btn-primary')).toHaveText('Home');
  await expect(page.locator('.nav-actions .btn-primary')).toHaveAttribute('href', '/');

  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/auth-marketing-home-cta.png' });
});
