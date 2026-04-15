import { test, expect } from '@playwright/test';

test('shortcuts map correctly to block types', async ({ page }) => {
  await page.goto('http://localhost:8001/index.html');
  await page.click('#newProjectBtn');
  await page.waitForSelector('.script-block');

  const block = page.locator('.script-block').first();
  await block.focus();

  // Alt+C -> character
  await page.keyboard.press('Alt+c');
  await expect(page.locator('.script-block-row').first()).toHaveAttribute('data-type', 'character');

  // Alt+S -> shot
  await page.keyboard.press('Alt+s');
  await expect(page.locator('.script-block-row').first()).toHaveAttribute('data-type', 'shot');

  // Alt+E -> scene
  await page.keyboard.press('Alt+e');
  await expect(page.locator('.script-block-row').first()).toHaveAttribute('data-type', 'scene');
});
