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

    # Try Word export on empty script using evaluate to avoid visibility issues with menus
    print("Triggering export via JS...")
    await page.evaluate("exportWord()")

    # Check for custom modal
    await page.wait_for_selector("#customModal[open]")
    modal_title = await page.inner_text("#modalTitle")
    modal_msg = await page.inner_text("#modalMessage")

    print(f"Modal Title: {modal_title}")
    print(f"Modal Message: {modal_msg}")

    await browser.close()
    await async_playwright_instance.stop()

if __name__ == '__main__':
    asyncio.run(run())
