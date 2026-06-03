import { test, expect } from '@playwright/test';
import { login } from './helper.js';

async function openFilmCreationFlow(page, name) {
  await page.locator('#newProjectBtn').click();
  await page.getByRole('button', { name: /Film Script/i }).click();
  await expect(page.getByRole('heading', { name: /Name your script/i })).toBeVisible();
  await page.getByPlaceholder('Write script name').fill(name);
}

test('workspace dashboard exposes the core SaaS workflow loop', async ({ page }) => {
  const projectName = 'Core SaaS Workflow Script';

  await login(page);
  await openFilmCreationFlow(page, projectName);
  await page.locator('[data-creation-action="start-new"]').click();

  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await page.locator('#goHomeBtn').click();
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });

  await page.locator('.project-card').filter({ hasText: projectName }).first().locator('[data-open-workspace-id]').click();
  await expect(page.locator('#workspaceView')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.workspace-flow-strip')).toBeVisible();
  await expect(page.locator('.workspace-flow-strip')).toContainText('Write');
  await expect(page.locator('.workspace-flow-strip')).toContainText('Assign');
  await expect(page.locator('.workspace-flow-strip')).toContainText('Track');

  await page.locator('[data-workspace-home-action="focus-task-form"]').click();
  await expect(page.locator('[data-workspace-task-title]')).toBeFocused();
  await page.locator('[data-workspace-task-title]').fill('Track the first writing pass');
  await page.locator('[data-workspace-home-action="add-task"]').click();
  await expect(page.locator('.workspace-task-card').filter({ hasText: 'Track the first writing pass' })).toBeVisible({ timeout: 15000 });

  await page.locator('[data-workspace-home-action="continue-writing"]').click();
  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#titleInput')).toHaveValue(projectName);
});
