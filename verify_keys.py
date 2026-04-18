import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto('http://localhost:8000/index.html')

        # Login
        await page.fill('input[type="email"]', 'test@example.com')
        await page.fill('input[type="password"]', 'password')
        await page.click('button:has-text("Sign In")')
        await page.wait_for_selector('#newProjectBtn')

        await page.click('#newProjectBtn')
        await page.wait_for_selector('.script-block')

        block = page.locator('.script-block').first()
        await block.focus()

        print("Initial type:", await page.locator('.script-block-row').first().get_attribute('data-type'))

        # Try Alt+C
        await page.keyboard.press('Alt+c')
        await asyncio.sleep(1)

        print("After Alt+C type:", await page.locator('.script-block-row').first().get_attribute('data-type'))

        # Try Alt+S
        await page.keyboard.press('Alt+s')
        await asyncio.sleep(1)

        print("After Alt+S type:", await page.locator('.script-block-row').first().get_attribute('data-type'))

        await page.screenshot(path='shortcut_verification.png')
        await browser.close()

asyncio.run(run())
