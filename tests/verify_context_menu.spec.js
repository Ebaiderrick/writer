import { test, expect } from '@playwright/test';
import { login } from './helper.js';

async function openEditor(page) {
  await page.goto('http://localhost:8000/index.html');
  await login(page);
  await page.click('#newProjectBtn');
  await page.waitForSelector('.script-block');
  return page.locator('.script-block').first();
}

test('editor right click shows the custom context menu with duplicate and sentence case', async ({ page }) => {
  const block = await openEditor(page);

  await block.click({ button: 'right' });

  const menu = page.locator('#contextMenu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-action="duplicate"]')).toBeVisible();

  const capsMenu = menu.locator('.menu-item.has-submenu').filter({ hasText: 'Capitalization' });
  await capsMenu.hover();
  await expect(menu.locator('[data-action="caps-sentence"]')).toBeVisible();
});

test('sentence case and duplicate work from the editor context menu', async ({ page }) => {
  const block = await openEditor(page);

  await block.click();
  await page.keyboard.type('gOOD MORNING. hOW ARE YOU?');

  await page.evaluate(() => {
    const blockEl = document.querySelector('.script-block');
    const range = document.createRange();
    range.selectNodeContents(blockEl);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });

  await block.click({ button: 'right' });
  const capsMenu = page.locator('#contextMenu .menu-item.has-submenu').filter({ hasText: 'Capitalization' });
  await capsMenu.hover();
  await page.locator('#contextMenu [data-action="caps-sentence"]').click();

  await expect(page.locator('.script-block').first()).toHaveText('Good morning. How are you?');

  await page.locator('.script-block').first().click({ button: 'right' });
  await page.locator('#contextMenu [data-action="duplicate"]').click();

  await expect(page.locator('.script-block-row')).toHaveCount(2);
  await expect(page.locator('.script-block').nth(1)).toHaveText('Good morning. How are you?');
});

test('changing block type no longer destroys the original text casing', async ({ page }) => {
  const block = await openEditor(page);

  await block.click();
  await page.keyboard.type('Good Morning');
  await page.keyboard.press('Alt+e');
  await page.waitForTimeout(150);
  await page.keyboard.press('Alt+a');

  await expect(page.locator('.script-block').first()).toHaveText('Good Morning');
});
