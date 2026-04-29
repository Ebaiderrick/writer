import asyncio
from playwright.async_api import async_playwright

async def run():
    async_playwright_instance = await async_playwright().start()
    browser = await async_playwright_instance.chromium.launch()
    page = await browser.new_page()
    page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))

    await page.goto("http://localhost:8000/test_docx.html")
    await asyncio.sleep(2)

    await browser.close()
    await async_playwright_instance.stop()

if __name__ == '__main__':
    asyncio.run(run())
