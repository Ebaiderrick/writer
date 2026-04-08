import asyncio
from playwright.async_api import async_playwright
import os
import subprocess
import time

async def verify_refined_landing_page():
    # Start server
    server_process = subprocess.Popen(['python3', '-m', 'http.server', '8083'])
    time.sleep(2)

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()

        print("Opening http://localhost:8083/index.html")
        await page.goto('http://localhost:8083/index.html')

        # Verify hero changes
        hero_h1 = await page.text_content('.home-hero h1')
        print(f"Hero H1: {hero_h1}")
        tagline = await page.text_content('.home-tagline')
        print(f"Tagline: {tagline}")

        # Verify logo position (should be before h1)
        logo_index = await page.evaluate('document.querySelector(".home-logo").compareDocumentPosition(document.querySelector(".home-hero h1"))')
        print(f"Logo position relative to H1 (4 means after, 2 means before): {logo_index}")

        # Capture landing page screenshot
        screenshot_path = '/home/jules/verification/refined_landing_page.png'
        await page.screenshot(path=screenshot_path)
        print(f"Refined landing page screenshot saved to {screenshot_path}")

        # Test deletion with retyping
        print("Testing secure deletion...")
        project_name = await page.text_content('.project-card-title')
        print(f"Deleting project: {project_name}")

        # Listen for dialog
        async def handle_dialog(dialog):
            print(f"Dialog showing: {dialog.message}")
            await dialog.accept(project_name)

        page.on("dialog", handle_dialog)

        await page.click('.project-delete')
        await asyncio.sleep(1) # wait for render

        cards_count = await page.locator('.project-card').count()
        print(f"Cards count after deletion: {cards_count}")

        await browser.close()

    server_process.terminate()

if __name__ == "__main__":
    asyncio.run(verify_refined_landing_page())
