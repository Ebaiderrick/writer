import asyncio
from playwright.async_api import async_playwright

async def run():
    async_playwright_instance = await async_playwright().start()
    browser = await async_playwright_instance.chromium.launch()
    page = await browser.new_page()

    await page.goto("http://localhost:8000")
    # Bypass auth
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
    await page.wait_for_selector(".project-card")
    await page.click(".project-card-open")
    await page.wait_for_selector("#screenplayEditor")

    # Check if Export buttons exist and are visible in File menu
    await page.click("[data-menu-trigger='studioFileMenu']")
    word_btn = page.locator("[data-menu-action='export-word']")
    pdf_btn = page.locator("[data-menu-action='export-pdf']")

    print(f"Word export button visible: {await word_btn.is_visible()}")
    print(f"PDF export button visible: {await pdf_btn.is_visible()}")

    # Check Project Tools panel buttons
    await page.click("button[data-left-pane-section-toggle='tools']")
    tools_word_btn = page.locator("#exportWordBtn")
    tools_pdf_btn = page.locator("#exportPdfBtn")
    print(f"Tools Word export button visible: {await tools_word_btn.is_visible()}")
    print(f"Tools PDF export button visible: {await tools_pdf_btn.is_visible()}")

    await browser.close()
    await async_playwright_instance.stop()

if __name__ == '__main__':
    asyncio.run(run())
