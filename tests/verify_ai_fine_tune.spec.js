import { test, expect } from '@playwright/test';

test('AI button appears on empty lines', async ({ page }) => {
  await page.goto('http://localhost:8000');

  // Wait for the app to load
  await page.waitForSelector('body');

  // Click "New Script" button on home page
  const newScriptBtn = page.locator('#newProjectBtn');
  await newScriptBtn.waitFor({ state: 'visible' });
  await newScriptBtn.click();

  // Wait for studio view to show
  await page.waitForSelector('#studioView:not([hidden])');

  // Enable AI Assist
  await page.check('#aiAssistToggle');

  // Find the first block and make it empty
  const firstBlock = page.locator('.script-block').first();
  await firstBlock.waitFor({ state: 'visible' });
  await firstBlock.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');

  // Hover over the empty block's row
  const row = page.locator('.script-block-row').first();
  await row.hover();

  // Check if AI button is visible
  const aiBtn = row.locator('.ai-btn');
  await expect(aiBtn).toBeVisible();

  await page.screenshot({ path: 'verification/ai_empty_line.png' });
});

test('AI interaction flow - action and instruction', async ({ page }) => {
  await page.goto('http://localhost:8000');

  // Click "New Script" button
  await page.click('#newProjectBtn');

  // Wait for studio view
  await page.waitForSelector('#studioView:not([hidden])');

  // Enable AI Assist
  await page.check('#aiAssistToggle');

  // Fill some text (it starts as ACTION type by default)
  const firstBlock = page.locator('.script-block').first();
  await firstBlock.fill('A lone traveler walks across the desert.');

  // Hover to reveal AI button
  const row = page.locator('.script-block-row').first();
  await row.hover();

  const aiBtn = row.locator('.ai-btn');
  await aiBtn.waitFor({ state: 'visible' });
  await aiBtn.click();

  // Wait for menu
  await page.waitForSelector('.ai-menu', { state: 'visible' });

  // Click "Visualize" (present for Action blocks)
  const visualizeBtn = page.locator('.ai-menu-item').filter({ hasText: 'Visualize' }).first();
  await visualizeBtn.click();

  // Check for selection highlight
  await expect(visualizeBtn).toHaveClass(/is-selected/);

  // Check for input and Go button
  const input = page.locator('.ai-input');
  await expect(input).toBeVisible();
  const goBtn = page.locator('.ai-submit-btn');
  await expect(goBtn).toBeVisible();

  // Type something
  await input.fill('The heat is shimmering off the sand.');

  // Take screenshot of the menu
  await page.screenshot({ path: 'verification/ai_menu_flow.png' });
});
