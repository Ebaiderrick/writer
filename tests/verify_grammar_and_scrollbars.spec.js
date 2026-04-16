import { test, expect } from '@playwright/test';

test('grammar check toggle and ai menu integration', async ({ page }) => {
  await page.goto('http://localhost:8001/index.html');
  await page.click('#newProjectBtn');
  await page.waitForSelector('.script-block');

  // 1. Verify toggle exists
  const toggle = page.locator('#grammarCheckToggle');
  await expect(toggle).toBeVisible();

  // 2. Enable AI and Grammar check
  await page.check('#aiAssistToggle');
  await page.check('#grammarCheckToggle');

  // 3. Trigger AI menu
  const block = page.locator('.script-block').first();
  await block.click();
  await page.hover('.script-block-row');
  await page.click('.ai-btn');

  // 4. Verify 'Grammar' option is present
  await expect(page.locator('.ai-menu-item:has-text("Grammar")')).toBeVisible();

  // Take screenshot
  await page.screenshot({ path: 'verification/grammar_ui.png' });
});
