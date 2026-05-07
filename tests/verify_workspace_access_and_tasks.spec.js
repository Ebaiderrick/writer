import { test, expect } from '@playwright/test';
import { login } from './helper.js';

async function seedWorkspace(page) {
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const workspace = {
      id: 'workspace_alpha',
      name: 'Alpha Workspace',
      inviteCode: 'ALPHA1',
      tasks: [],
      reminders: [],
      targets: {},
      notifications: []
    };
    const rootProject = {
      id: 'workspace_root',
      title: 'Alpha Workspace',
      isWorkspaceRoot: true,
      creationKind: 'workspace',
      workType: 'film-script',
      isShared: true,
      ownerId: 'owner_uid',
      ownerName: 'Owner One',
      ownerEmail: 'owner@example.com',
      collaborators: {
        collab_uid: {
          name: 'Collab User',
          email: 'collab@example.com',
          role: 'editor'
        }
      },
      workspace,
      lines: [{ id: 'root_line_1', type: 'action', text: '' }],
      updatedAt: now,
      createdAt: now
    };
    const childProject = {
      id: 'project_alpha',
      title: 'Project Alpha',
      creationKind: 'project',
      workType: 'film-script',
      isShared: true,
      ownerId: 'owner_uid',
      ownerName: 'Owner One',
      ownerEmail: 'owner@example.com',
      collaborators: {
        collab_uid: {
          name: 'Collab User',
          email: 'collab@example.com',
          role: 'editor'
        }
      },
      workspace,
      lines: [
        { id: 'scene_1', type: 'scene', text: 'INT. OFFICE - DAY' },
        { id: 'line_1', type: 'action', text: 'A tense silence hangs in the room.' }
      ],
      updatedAt: now,
      createdAt: now
    };
    const payload = {
      savedAt: now,
      currentProjectId: childProject.id,
      currentWorkspaceId: null,
      projects: [childProject, rootProject],
      aiAssist: false,
      grammarCheck: false,
      toolStripCollapsed: false,
      autoNumberScenes: false,
      backgroundAnimation: true,
      theme: 'cedar',
      language: 'en',
      writingLanguage: 'en',
      localBackupEnabled: false,
      localSaveIntervalMinutes: 5,
      backupPrompted: true,
      tourShown: true,
      viewOptions: {
        ruler: false,
        pageNumbers: true,
        pageCount: false,
        showOutline: true,
        textSize: 12,
        focusMode: false
      },
      leftPaneBlocks: []
    };
    localStorage.setItem('eyawriter-projects-v5', JSON.stringify(payload));
    localStorage.setItem('eyawriter-projects-v5:recovery', JSON.stringify(payload));
  });
  await page.reload();
  await expect(page.locator('#homeView')).toBeVisible();
}

test('landing project cards open the editor from the visible card area', async ({ page }) => {
  await login(page);
  await seedWorkspace(page);

  await page.locator('.project-card .project-card-title').first().click();

  await expect(page.locator('#studioView')).toBeVisible();
  await expect(page.locator('#titleInput')).toHaveValue('Project Alpha');
});

test('workspace editor button opens a script and task creation can assign any member', async ({ page }) => {
  await login(page);
  await seedWorkspace(page);

  await page.locator('.project-card-context-action', { hasText: 'Open Workspace' }).first().click();
  await expect(page.locator('#workspaceView')).toBeVisible();

  const assigneeSelect = page.locator('#workspaceDashboard [data-workspace-task-assignee]');
  await expect(assigneeSelect).toContainText('Owner One');
  await expect(assigneeSelect).toContainText('Collab User');

  await page.locator('#workspaceDashboard [data-workspace-task-title]').fill('Review Act Two');
  await assigneeSelect.selectOption('collab_uid');
  await page.locator('#workspaceDashboard [data-workspace-home-action="add-task"]').click();

  await expect(page.locator('#workspaceDashboard')).toContainText('Review Act Two');
  await expect(page.locator('#workspaceDashboard')).toContainText('Collab User');

  await page.locator('#workspaceEditorBtn').click();
  await expect(page.locator('#studioView')).toBeVisible();
  await expect(page.locator('#titleInput')).toHaveValue('Project Alpha');
});
