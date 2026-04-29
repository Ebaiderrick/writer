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

    # Check if libraries are loaded
    docx_loaded = await page.evaluate("typeof docx !== 'undefined'")
    html2pdf_loaded = await page.evaluate("typeof html2pdf !== 'undefined'")

    print(f"docx library loaded: {docx_loaded}")
    print(f"html2pdf library loaded: {html2pdf_loaded}")

    # Check if export buttons exist in the DOM
    word_btn_exists = await page.evaluate("!!document.querySelector('[data-menu-action=\"export-word\"]')")
    pdf_btn_exists = await page.evaluate("!!document.querySelector('[data-menu-action=\"export-pdf\"]')")

    print(f"Word export button exists: {word_btn_exists}")
    print(f"PDF export button exists: {pdf_btn_exists}")

    await browser.close()
    await async_playwright_instance.stop()

if __name__ == '__main__':
    asyncio.run(run())
