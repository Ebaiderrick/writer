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

test('whole-field sentence case and duplicate work without manual selection', async ({ page }) => {
  const block = await openEditor(page);

  await block.click();
  await page.keyboard.type('gOOD MORNING. hOW ARE YOU?');

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

test('partial selection only applies commands to the selected text', async ({ page }) => {
  const block = await openEditor(page);

  await block.click();
  await page.keyboard.type('hello WORLD');

  await page.evaluate(() => {
    const textNode = document.querySelector('.script-block').firstChild;
    const range = document.createRange();
    range.setStart(textNode, 6);
    range.setEnd(textNode, 11);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });

  await block.click({ button: 'right' });
  const capsMenu = page.locator('#contextMenu .menu-item.has-submenu').filter({ hasText: 'Capitalization' });
  await capsMenu.hover();
  await page.locator('#contextMenu [data-action="caps-low"]').click();

  await expect(page.locator('.script-block').first()).toHaveText('hello world');
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

test('parenthetical typing preserves spaces immediately and revision moves under tools', async ({ page }) => {
  const block = await openEditor(page);

  await page.keyboard.press('Alt+p');
  await block.click();
  await page.keyboard.type('quietly ');
  await expect(page.locator('.script-block').first()).toHaveText('(quietly )');

  await page.locator('[data-menu-trigger="studioToolsMenu"]').click();
  await expect(page.locator('[data-menu-trigger="studioRevisionMenu"]')).toHaveCount(0);
  await expect(page.locator('#studioToolsMenu .menu-group-summary').filter({ hasText: 'Revision' })).toBeVisible();
  await expect(page.locator('[data-menu-trigger="studioSettingsMenu"]')).toBeVisible();
});
