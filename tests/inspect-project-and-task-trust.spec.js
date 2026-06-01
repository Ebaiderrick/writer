import { test, expect } from '@playwright/test';
import path from 'node:path';
import { login } from './helper.js';

const ARTIFACTS_DIR = path.resolve('C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts');

async function openFilmCreationFlow(page, name) {
  await page.locator('#newProjectBtn').click();
  await page.getByRole('button', { name: /Film Script/i }).click();
  await expect(page.getByRole('heading', { name: /Name your script/i })).toBeVisible();
  await page.getByPlaceholder('Write script name').fill(name);
}

test('project cards and workspace tasks open their linked script reliably', async ({ page }) => {
  const projectName = 'Phase A Trust Script';

  await login(page);
  await openFilmCreationFlow(page, projectName);
  await page.locator('[data-creation-action="start-new"]').click();

  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await page.locator('#goHomeBtn').click();
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });

  const projectCard = page.locator('.project-card').filter({ hasText: projectName }).first();
  await expect(projectCard).toBeVisible({ timeout: 15000 });
  await projectCard.locator('.project-card-open').click();
  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#titleInput')).toHaveValue(projectName);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase-a-project-open.png') });

  await page.locator('#goHomeBtn').click();
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });

  await projectCard.locator('[data-open-workspace-id]').click();
  await expect(page.locator('#workspaceView')).toBeVisible({ timeout: 15000 });

  await page.locator('[data-workspace-task-title]').fill('Open this script from a workspace task');
  await page.locator('[data-workspace-home-action="add-task"]').click();

  const createdTask = page.locator('.workspace-task-card').filter({ hasText: 'Open this script from a workspace task' }).first();
  await expect(createdTask).toBeVisible({ timeout: 15000 });
  await createdTask.locator('[data-workspace-home-action="open-task-project"]').click();

  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#titleInput')).toHaveValue(projectName);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'phase-a-task-open-project.png') });
});
