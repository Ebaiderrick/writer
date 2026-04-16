import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('grammar check toggle and ai menu integration', async ({ page }) => {
  await page.goto('http://localhost:8000/index.html');
  await login(page);
  await page.click('#newProjectBtn');
  await page.waitForSelector('.script-block');

  // Enable AI Assist and grammar check
  await page.check('#aiAssistToggle');
  await page.check('#grammarCheckToggle');

  // Check if body has class
  await expect(page.locator('body')).toHaveClass(/grammar-mode-active/);

  // Focus block and click AI button
  const block = page.locator('.script-block').first();
  await block.click();
  const aiBtn = page.locator('.ai-btn').first();
  await aiBtn.click();

  // Verify "Grammar" is in the menu and has special class
  const grammarItem = page.locator('.ai-menu-item').filter({ hasText: 'Grammar' });
  await expect(grammarItem).toBeVisible();
  await expect(grammarItem).toHaveClass(/is-grammar/);
});
