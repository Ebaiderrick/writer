import { test, expect } from '@playwright/test';

export async function login(page) {
  await page.goto('http://localhost:8000');

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

  await page.reload();

  // Wait for the app to detect session and show homeView
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });
}
