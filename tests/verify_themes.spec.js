import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('verify white and cedar themes', async ({ page }) => {
    // Navigate and login
    await page.goto('http://localhost:8000');
    await login(page);

    // Wait for the home view
    await expect(page.locator('.home-view')).toBeVisible();

    // Check White Theme
    await page.click('.theme-btn[data-theme="white"]');
    await page.waitForTimeout(1000); // Wait for transition
    await page.screenshot({ path: 'verify_white_theme.png' });

    // Check Cedar (Rose) Theme
    await page.click('.theme-btn[data-theme="rose"]');
    await page.waitForTimeout(1000); // Wait for transition
    await page.screenshot({ path: 'verify_cedar_theme.png' });

    // Check Profile visibility in White Theme
    await page.click('.theme-btn[data-theme="white"]');
    await page.click('.user-trigger');
    await expect(page.locator('.popup-overlay.active')).toBeVisible();
    await page.screenshot({ path: 'verify_profile_white.png' });
});
