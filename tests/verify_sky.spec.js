import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('verify cedar sky theme', async ({ page }) => {
    await login(page);
    await page.goto('http://localhost:8000');

    // Switch to Cedar (Rose)
    await page.click('.theme-btn[data-theme="rose"]');
    await page.waitForTimeout(1000); // Wait for transition
    await page.screenshot({ path: 'verify_cedar_sky.png' });

    // Switch to White
    await page.click('.theme-btn[data-theme="white"]');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'verify_white_aurora.png' });
});
