import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test('verify white and cedar (rose) themes', async ({ page }) => {
    await login(page);

    // Wait for the home view
    await expect(page.locator('#homeView')).toBeVisible();

    const themes = ['white', 'cedar', 'dark', 'navy'];

    for (const theme of themes) {
        console.log(`Testing theme: ${theme}`);
        await page.evaluate((t) => {
            const btn = document.querySelector(`.theme-option[data-theme-value="${t}"]`);
            if (btn) btn.click();
        }, theme);

        await page.waitForTimeout(1000); // Wait for transition

        const currentTheme = await page.evaluate(() => document.documentElement.dataset.theme);
        expect(currentTheme).toBe(theme);

        await page.screenshot({ path: `theme_check_${theme}.png` });
    }
});
