import { test, expect } from '@playwright/test';
import { login } from './helper.js';

test.describe('project card mobile interactions', () => {
  test.use({
    viewport: { width: 430, height: 932 },
    hasTouch: true,
    isMobile: true
  });

  test('tap opens project but scroll gesture does not', async ({ page }) => {
    await login(page);

    const card = page.locator('.project-card').first();
    await expect(card).toBeVisible();
    await expect(page.locator('#studioView')).toBeHidden();

    await page.locator('.project-card-title').first().click();
    await expect(page.locator('#studioView')).toBeVisible();

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#homeView')).toBeVisible();
    await expect(page.locator('.project-card').first()).toBeVisible();

    await page.evaluate(() => {
      const card = document.querySelector('.project-card');
      if (!card) throw new Error('Project card not found');

      const createTouchEvent = (type, x, y) => new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        changedTouches: [
          new Touch({
            identifier: 1,
            target: card,
            clientX: x,
            clientY: y,
            radiusX: 2,
            radiusY: 2,
            rotationAngle: 0,
            force: 0.5
          })
        ]
      });

      card.dispatchEvent(createTouchEvent('touchstart', 80, 180));
      card.dispatchEvent(createTouchEvent('touchmove', 80, 110));
      card.dispatchEvent(createTouchEvent('touchend', 80, 110));
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await expect(page.locator('#homeView')).toBeVisible();
    await expect(page.locator('#studioView')).toBeHidden();
  });
});
