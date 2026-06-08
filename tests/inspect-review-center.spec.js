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

test('review center feels readable and visually structured', async ({ page }) => {
  const projectName = 'Review Center UX Script';

  await login(page);
  await openFilmCreationFlow(page, projectName);
  await page.locator('[data-creation-action="start-new"]').click();

  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await page.locator('#goHomeBtn').click();
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });

  const projectCard = page.locator('.project-card').filter({ hasText: projectName }).first();
  await projectCard.locator('[data-open-workspace-id]').click();
  await expect(page.locator('#workspaceView')).toBeVisible({ timeout: 15000 });

  await page.locator('[data-workspace-task-title]').fill('Review the first scene');
  await page.locator('[data-workspace-home-action="add-task"]').click();
  await expect(page.locator('.workspace-task-card').filter({ hasText: 'Review the first scene' }).first()).toBeVisible({ timeout: 15000 });

  await page.locator('[data-workspace-home-action="open-review-center"]').click();
  await expect(page.locator('#modalTitle')).toHaveText('Review Center', { timeout: 15000 });
  await expect(page.locator('.workspace-review-center')).toBeVisible();
  await expect(page.locator('[data-review-report-head] strong')).toHaveText(/Choose a report or write a prompt/i);

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'review-center-polish.png') });

  await page.locator('[data-review-report-select]').selectOption('character-list');
  await page.locator('[data-review-run-report]').click();
  await expect(page.locator('[data-review-report-head] strong')).toHaveText(/Character List Report/i);
  await page.locator('[data-review-report-select]').selectOption('');
  await page.locator('[data-review-report-prompt]').fill('Give me a report about scenery and setting clarity.');
  await page.locator('[data-review-run-report]').click();
  await expect(page.locator('[data-review-report-head] strong')).toHaveText(/Scenery Development Report/i);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'review-center-progress.png') });
});
