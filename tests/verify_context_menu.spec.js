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

test('scene and shot enforce uppercase bold display without losing stored text', async ({ page }) => {
  const block = await openEditor(page);
  const firstBlock = page.locator('.script-block').first();

  await block.click();
  await page.keyboard.type('Interior loft - dawn');
  await page.keyboard.press('Alt+e');

  await expect(firstBlock).toHaveCSS('text-transform', 'uppercase');
  expect(await firstBlock.evaluate((el) => getComputedStyle(el).fontWeight)).toMatch(/700|bold/);

  await page.keyboard.press('Alt+s');
  await expect(firstBlock).toHaveCSS('text-transform', 'uppercase');
  expect(await firstBlock.evaluate((el) => getComputedStyle(el).fontWeight)).toMatch(/700|bold/);

  await page.keyboard.press('Alt+a');
  await expect(firstBlock).toHaveText('Interior loft - dawn');
});

test('parenthetical typing preserves spaces immediately and revision moves under tools', async ({ page }) => {
  const block = await openEditor(page);

  await page.keyboard.press('Alt+p');
  await block.click();
  await page.keyboard.type('quietly ');
  await expect(page.locator('.script-block').first()).toHaveText('(quietly )');

  await page.locator('[data-menu-trigger="studioToolsMenu"]').hover();
  await expect(page.locator('[data-menu-trigger="studioRevisionMenu"]')).toHaveCount(0);
  await expect(page.locator('#studioToolsMenu .menu-group-summary').filter({ hasText: 'Revision & Insight' })).toBeVisible();
  await expect(page.locator('[data-menu-trigger="studioSettingsMenu"]')).toBeVisible();
});

test('active block customization lives in settings and updates the left pane', async ({ page }) => {
  await openEditor(page);

  await page.locator('[data-menu-trigger="studioSettingsMenu"]').hover();
  await expect(page.locator('#studioSettingsMenu')).toBeVisible();
  await page.locator('#studioSettingsMenu .menu-group-summary').filter({ hasText: 'Editor' }).click();
  await page.locator('#studioSettingsMenu [data-menu-action="customize-active-blocks"]').click();
  await expect(page.locator('#customModal')).toHaveAttribute('open', '');
  await expect(page.locator('#modalTitle')).toHaveText('Customize Active Blocks');
  await expect(page.locator('#customModal')).toContainText('Editor');
  await expect(page.locator('#customModal')).toContainText('Writing');
  await expect(page.locator('#customModal')).toContainText('Revision & Insight');

  await page.locator('#customModal [data-left-pane-key="metrics"][data-left-pane-move="up"]').evaluate((button) => button.click());
  await page.locator('#customModal [data-left-pane-key="metrics"][data-left-pane-move="up"]').evaluate((button) => button.click());
  await page.locator('#customModal [data-left-pane-visibility="characters"]').evaluate((checkbox) => {
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-left-pane-block]'))
      .filter((section) => !section.hidden)
      .sort((a, b) => Number(a.style.order) - Number(b.style.order))
      .map((section) => section.dataset.leftPaneBlock)
  );
  expect(order.indexOf('metrics')).toBeLessThan(order.indexOf('scenes'));
  await expect(page.locator('[data-left-pane-block="characters"]')).toBeHidden();

  await page.locator('#modalCancelBtn').click();
  await page.locator('[data-left-pane-section-toggle="metrics"]').click();
  await expect(page.locator('[data-left-pane-block="metrics"] .panel-section-body')).toBeHidden();
});

test('toolbar tools open popups for editor, story memory, and grammar check', async ({ page }) => {
  const block = await openEditor(page);

  await block.click();
  await page.keyboard.type('Line one');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Line two');
  const hasSoftBreak = await page.locator('.script-block').first().evaluate((el) => {
    const innerHtml = el.innerHTML || '';
    const innerText = el.innerText || '';
    return innerHtml.includes('<br') || innerText.includes('\n');
  });
  expect(hasSoftBreak).toBe(true);

  await page.locator('[data-menu-trigger="studioToolsMenu"]').hover();
  await page.locator('#studioToolsMenu').evaluate((menu) => {
    menu.querySelectorAll('details.menu-group').forEach((group) => {
      group.open = true;
    });
  });
  await page.locator('#studioToolsMenu [data-menu-action="open-editor"]').click();
  await expect(page.locator('#modalTitle')).toHaveText('Editor');
  await expect(page.locator('#customModal')).toContainText('Team Editor');
  await page.locator('#modalCancelBtn').click();

  await page.locator('[data-menu-trigger="studioToolsMenu"]').hover();
  await page.locator('#studioToolsMenu').evaluate((menu) => {
    menu.querySelectorAll('details.menu-group').forEach((group) => {
      group.open = true;
    });
  });
  await page.locator('#studioToolsMenu [data-menu-action="open-story-memory"]').click();
  await expect(page.locator('#modalTitle')).toHaveText('Story Memory');
  await expect(page.locator('#customModal')).toContainText('Insert Into Active Block');
  await page.locator('#modalCancelBtn').click();

  await page.locator('[data-menu-trigger="studioToolsMenu"]').hover();
  await page.locator('#studioToolsMenu').evaluate((menu) => {
    menu.querySelectorAll('details.menu-group').forEach((group) => {
      group.open = true;
    });
  });
  await page.locator('#studioToolsMenu [data-menu-action="toggle-grammar-check"]').click();
  await expect(page.locator('#modalTitle')).toHaveText('Grammar Check');
  await expect(page.locator('#modalConfirmBtn')).toHaveText(/Turn On|Turn Off/);
});

test('view menu removes ruler, page count, and show outline options', async ({ page }) => {
  await openEditor(page);

  await page.locator('[data-menu-trigger="studioViewMenu"]').click();
  await expect(page.locator('#studioViewMenu')).not.toContainText('Ruler');
  await expect(page.locator('#studioViewMenu')).not.toContainText('Page Count');
  await expect(page.locator('#studioViewMenu')).not.toContainText('Show Outline');
});

test('file and edit menus expose the new export and text controls', async ({ page }) => {
  await openEditor(page);

  await page.locator('[data-menu-trigger="studioFileMenu"]').hover();
  await expect(page.locator('#studioFileMenu')).toBeVisible();
  await page.locator('#studioFileMenu').evaluate((menu) => {
    menu.querySelectorAll('details.menu-group').forEach((group) => {
      group.open = true;
    });
  });
  await expect(page.locator('#studioFileMenu [data-menu-action="save-home"]')).toBeVisible();
  await expect(page.locator('#studioFileMenu [data-menu-action="export-txt"]')).toBeVisible();

  await page.locator('[data-menu-trigger="studioEditMenu"]').hover();
  await expect(page.locator('#studioEditMenu')).toBeVisible();
  await page.locator('#studioEditMenu').evaluate((menu) => {
    menu.querySelectorAll('details.menu-group').forEach((group) => {
      group.open = true;
    });
  });
  await expect(page.locator('#studioEditMenu [data-menu-action="text-caps-sentence"]')).toBeVisible();
  await expect(page.locator('#studioEditMenu [data-menu-action="text-copy"]')).toBeVisible();
  await expect(page.locator('#studioEditMenu [data-menu-action="text-cut"]')).toBeVisible();
  await expect(page.locator('#studioEditMenu [data-menu-action="text-paste"]')).toBeVisible();
  await expect(page.locator('#studioEditMenu [data-menu-action="text-duplicate"]')).toBeVisible();
});
