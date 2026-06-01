import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('file recovery restores a deleted script back to home', async ({ page }) => {
  await login(page);

  await page.evaluate(async () => {
    const { archiveDeletedProjects } = await import('/js/project.js');
    archiveDeletedProjects([
      {
        id: 'recovery_trust_script',
        title: 'Recovery Trust Script',
        author: 'Tester',
        contact: '',
        company: '',
        details: '',
        logline: '',
        lines: [
          { id: 'line_1', type: 'scene', text: 'INT. TEST ROOM - DAY' },
          { id: 'line_2', type: 'dialogue', text: 'Recovered cleanly.' }
        ]
      }
    ]);
  });

  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.evaluate(() => {
    const menu = document.getElementById('homeFileMenu');
    if (menu) {
      menu.hidden = false;
      menu.style.display = 'block';
    }
  });
  await page.locator('#homeFileMenu [data-menu-action="open-file-recovery"]').click();

  await expect(page.locator('#fileRecoveryDialog[open]')).toBeVisible();
  await expect(page.locator('#fileRecoveryStateTitle')).toContainText('1 recoverable file');
  await expect(page.locator('#fileRecoveryList')).toContainText('Recovery Trust Script');
  await page.locator('[data-recovery-id="recovery_trust_script"] [data-recovery-action="recover"]').click();

  await expect(page.locator('#projectGrid')).toContainText('Recovery Trust Script');
  await expect(page.locator('.app-toast')).toContainText('Recovered "Recovery Trust Script".');

  await page.screenshot({ path: 'C:/Users/NKEDE GEOR/Desktop/writer app/writer-repo/artifacts/file-recovery-restored.png' });
});
