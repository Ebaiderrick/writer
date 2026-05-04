import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('verify landing workspace UI', async ({ page }) => {
  await login(page);

  // Mock a workspace state
  await page.evaluate(() => {
    const storageKey = "eyawriter-projects-v5";
    const existing = JSON.parse(localStorage.getItem(storageKey) || '{}');

    // Create a mock project that is a workspace lead
    const mockWorkspaceProject = {
      id: 'ws_lead',
      title: 'Testing Workspace',
      lines: [{ type: 'scene', text: 'SCENE 1' }],
      updatedAt: new Date().toISOString(),
      ownerId: 'user_test',
      isWorkspaceRoot: true,
      workspace: {
        id: 'ws_1',
        name: 'Testing Workspace',
        inviteCode: 'TESTCODE',
        tasks: [],
        reminders: []
      }
    };

    // Create another project in that workspace
    const mockProject = {
      id: 'p1',
      title: 'Project In Workspace',
      lines: [],
      updatedAt: new Date().toISOString(),
      workspace: { id: 'ws_1' }
    };

    existing.projects = [mockWorkspaceProject, mockProject];
    existing.currentWorkspaceId = 'ws_1';
    localStorage.setItem(storageKey, JSON.stringify(existing));
  });

  await page.goto('http://localhost:8000');

  // Wait for workspace view
  await expect(page.locator('#workspaceView')).toBeVisible({ timeout: 15000 });

  // Take screenshot
  await page.screenshot({ path: 'landing_workspace_after.png' });

  // Open the workspace popup from the editor to compare
  await page.click('text=Testing Workspace');
  await page.waitForSelector('.script-block');

  // Click on "Collaborate" or similar to open workspace popup
  await page.click('text=Collaborate');
  // Wait for the popup to appear. It's a <dialog>
  await page.waitForSelector('dialog.custom-modal');

  await page.screenshot({ path: 'workspace_popup_reference_after.png' });
});
