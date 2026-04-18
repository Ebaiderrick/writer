export async function login(page) {
  await page.evaluate(() => {
    localStorage.setItem('eyawriter_session', JSON.stringify({ email: 'test@example.com', loggedIn: true }));
  });
  await page.reload();
  await page.waitForSelector('#homeView:not([hidden])');
}
