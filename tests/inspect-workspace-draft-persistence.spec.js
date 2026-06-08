import { test, expect } from '@playwright/test';
import { login } from './helper.js';

async function openFilmCreationFlow(page, name) {
  await page.locator('#newProjectBtn').click();
  await page.getByRole('button', { name: /Film Script/i }).click();
  await expect(page.getByRole('heading', { name: /Name your script/i })).toBeVisible();
  await page.getByPlaceholder('Write script name').fill(name);
}

test('workspace quick assign draft survives workspace rerenders', async ({ page }) => {
  const projectName = 'Workspace Draft Persistence Script';
  const taskTitle = 'Keep this task draft during refresh';

  await login(page);
  await openFilmCreationFlow(page, projectName);
  await page.locator('[data-creation-action="start-new"]').click();

  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await page.locator('#goHomeBtn').click();
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });

  await page.locator('.project-card').filter({ hasText: projectName }).first().locator('[data-open-workspace-id]').click();
  await expect(page.locator('#workspaceView')).toBeVisible({ timeout: 15000 });

  const taskInput = page.locator('[data-workspace-task-title]');
  await taskInput.fill(taskTitle);
  await expect(taskInput).toHaveValue(taskTitle);

  const notificationFilter = page.locator('[data-workspace-home-action="set-notification-filter"]').first();
  await notificationFilter.selectOption('unread');

  await expect(page.locator('[data-workspace-task-title]')).toHaveValue(taskTitle);
});
