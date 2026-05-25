import { test, expect } from '@playwright/test';

test('save and home returns to the project landing page', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/');

  const demoLogin = page.locator('#demo-login-btn');
  if (await demoLogin.isVisible().catch(() => false)) {
    await demoLogin.click();
  }

  await expect(page.locator('#newProjectBtn')).toBeVisible();

  const projectCards = page.locator('#projectGrid .project-card');
  if (await projectCards.count() === 0) {
    await page.click('#newProjectBtn');
    await page.waitForTimeout(600);
  }

  await projectCards.first().locator('.project-card-open').click();
  await expect(page.locator('#goHomeBtn')).toBeVisible({ timeout: 10000 });

  for (const label of ['Not now', 'Skip', 'Later', 'Close', 'Cancel']) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click().catch(() => {});
      break;
    }
  }

  await page.click('#goHomeBtn');
  await page.waitForTimeout(1200);

  await expect(page.locator('#homeView')).toBeVisible();
  await expect(page.locator('#studioView')).toBeHidden();
  await expect(page.locator('#adminView')).toBeHidden();
  await expect(page.locator('#settingsView')).toBeHidden();
  await expect(page).toHaveURL('http://127.0.0.1:4173/');
  await expect(page.locator('#homeProjectsTitle')).toHaveText(/Scripts:/);
  await expect(page.locator('#projectGrid .project-card').first()).toBeVisible();
});
