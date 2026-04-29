import asyncio
from playwright.async_api import async_playwright

async def run():
    async_playwright_instance = await async_playwright().start()
    browser = await async_playwright_instance.chromium.launch()
    page = await browser.new_page()

    await page.goto("http://localhost:8000")
    await page.evaluate("""
        localStorage.setItem('eyawriter_session', JSON.stringify({
            userId: 'user_demo123',
            email: 'demo@eyawriter.com',
            name: 'Demo Writer',
            loggedIn: true,
            isDemoSession: true
        }));
    """)
    await page.reload()

    # Create a new (empty) project
    await page.click("#newProjectBtn")
    await page.wait_for_selector("#screenplayEditor")

    # Make tools visible if collapsed
    tools_panel = page.locator(".section-tools .panel-section-body")
    if not await tools_panel.is_visible():
        await page.click("button[data-left-pane-section-toggle='tools']")

    # Try Word export on empty script
    print("Clicking export button in tools...")
    await page.click("#exportWordBtn")

    # Check for custom modal
    print("Waiting for modal...")
    await page.wait_for_selector("#customModal[open]")
    modal_title = await page.inner_text("#modalTitle")
    modal_msg = await page.inner_text("#modalMessage")

    print(f"Modal Title: {modal_title}")
    print(f"Modal Message: {modal_msg}")

    await browser.close()
    await async_playwright_instance.stop()

if __name__ == '__main__':
    asyncio.run(run())
