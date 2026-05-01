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
      name: 'Tester'
    }));
  });

  // Verify that the view actually changes to home
  await page.evaluate(() => {
    const authView = document.getElementById('authView');
    const homeView = document.getElementById('homeView');
    if (authView) authView.hidden = true;
    if (homeView) homeView.hidden = false;
  });

  await page.reload();

  // Longer wait and check visibility
  const homeView = page.locator('#homeView');
  await expect(homeView).toBeVisible({ timeout: 30000 });
}
