export async function login(page) {
  await page.goto('http://localhost:8000');
  await page.evaluate(() => {
    const user = { id: 'user_test', email: 'test@example.com', name: 'Tester', password: 'password' };
    localStorage.setItem('eyawriter_users', JSON.stringify([user]));
    localStorage.setItem('eyawriter_session', JSON.stringify({ email: 'test@example.com', loggedIn: true, userId: 'user_test' }));
  });
  await page.reload();
  await page.waitForSelector('#homeView:not([hidden])', { timeout: 10000 });
}
