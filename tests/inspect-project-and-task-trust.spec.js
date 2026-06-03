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

  const workspaceProjectCard = page.locator('#workspaceProjectGrid .project-card').filter({ hasText: projectName }).first();
  await expect(workspaceProjectCard).toBeVisible({ timeout: 15000 });
  await workspaceProjectCard.locator('.project-card-open').click();
  await expect(page.locator('#studioView')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#titleInput')).toHaveValue(projectName);

  await page.locator('#goHomeBtn').click();
  await expect(page.locator('#homeView')).toBeVisible({ timeout: 15000 });
  await page.locator('.project-card').filter({ hasText: projectName }).first().locator('[data-open-workspace-id]').click();
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

test('stale project card clicks show recovery feedback instead of failing silently', async ({ page }) => {
  await login(page);

  await page.evaluate(() => {
    const grid = document.querySelector('#projectGrid');
    if (!grid) throw new Error('Missing project grid');
    const card = document.createElement('article');
    card.className = 'project-card';
    card.dataset.projectId = 'missing-project-id';
    card.innerHTML = `
      <div class="project-card-open" data-project-id="missing-project-id">
        <h3 class="project-card-title">Missing Trust Script</h3>
        <p class="project-card-logline">This stale card should not fail silently.</p>
      </div>
    `;
    grid.prepend(card);
  });

  await page.locator('.project-card').filter({ hasText: 'Missing Trust Script' }).first().click();
  await expect(page.locator('.app-toast').filter({ hasText: /could not be found|Refresh the workspace/i })).toBeVisible({ timeout: 5000 });
});
