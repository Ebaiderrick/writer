import { test, expect } from '@playwright/test';

test('tour displays and progresses through all steps', async ({ page }) => {
  await page.goto('http://localhost:8000');

  // Wait for tour to appear
  const container = page.locator('#tourContainer');
  await expect(container).toBeVisible({ timeout: 10000 });

  const text = page.locator('#text');

  // Progress through all 5 steps
  const steps = [
    "This is your writing space.",
    "Use these tools to change block functions.",
    "Navigate your scenes and characters here.",
    "See a live preview of your formatted script.",
    "Toggle AI assistance for rewrites and suggestions."
  ];

  for (const stepText of steps) {
    // Click to finish typing or go to next
    await page.click('#tourNext');
    // Wait for text to match expected (handling fast-forward)
    await expect(text).toHaveText(stepText);
    // Click to go to next step (unless last)
    await page.click('#tourNext');
    await page.waitForTimeout(600); // Wait for transition and delay
  }

  await expect(container).toBeHidden();
});
