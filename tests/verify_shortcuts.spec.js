import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('shortcuts map correctly to block types', async ({ page }) => {
  await page.goto('http://localhost:8000/index.html');
  await login(page);
  await page.click('#newProjectBtn');
  await page.waitForSelector('.script-block');

  const block = page.locator('.script-block').first();
  await block.focus();

  // Alt+C -> character
  await page.keyboard.press('Alt+c');
  // Add a small delay for the state change to propagate
  await page.waitForTimeout(500);
  await expect(page.locator('.script-block-row').first()).toHaveAttribute('data-type', 'character');

  // Alt+S -> shot
  await page.keyboard.press('Alt+s');
  await page.waitForTimeout(500);
  await expect(page.locator('.script-block-row').first()).toHaveAttribute('data-type', 'shot');

  // Alt+E -> scene
  await page.keyboard.press('Alt+e');
  await page.waitForTimeout(500);
  await expect(page.locator('.script-block-row').first()).toHaveAttribute('data-type', 'scene');
});
