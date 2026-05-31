import { test, expect } from '@playwright/test';

async function gotoWithRetry(page, url) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 750));
      }
    }
  }
  throw lastError;
}

export async function login(page) {
  await gotoWithRetry(page, 'http://127.0.0.1:4173/');

  // Inject mock user and session
  await page.evaluate(() => {
    const user = { id: 'user_test', email: 'test@example.com', name: 'Tester', password: 'password' };
    localStorage.setItem('eyawriter_users', JSON.stringify([user]));
    localStorage.setItem('eyawriter_session', JSON.stringify({
      email: 'test@example.com',
      loggedIn: true,
      userId: 'user_test',
      name: 'Tester',
      isDemoSession: true // Prevent onAuthStateChanged from clearing the session
    }));
    // Bypass backup prompt modal and tour by setting it in the main storage object
    const storageKey = "eyawriter-projects-v5";
    const existing = JSON.parse(localStorage.getItem(storageKey) || '{}');
    localStorage.setItem(storageKey, JSON.stringify({
      ...existing,
      backupPrompted: true,
      tourShown: true
    }));
  });

  await gotoWithRetry(page, 'http://127.0.0.1:4173/');

  // Wait for the app to detect session and show homeView
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });
}
