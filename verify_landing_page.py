import asyncio
from playwright.async_api import async_playwright
import os
import subprocess
import time

async def verify_landing_page():
    # Start a simple web server
    server_process = subprocess.Popen(['python3', '-m', 'http.server', '8081'])
    time.sleep(2) # Wait for server to start

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()

        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

        # Go to the app via localhost
        print("Opening http://localhost:8081/index.html")
        await page.goto('http://localhost:8081/index.html')

        # Wait for initial render
        await page.wait_for_selector('.project-card', timeout=5000)

        # Create multiple projects
        try:
            for i in range(5):
                print(f"Creating project {i+1}")
                await page.click('#newProjectBtn')
                await page.click('#goHomeBtn')
                # Wait for the home view and the grid to update
                await page.wait_for_selector('.project-grid')
        except Exception as e:
            print(f"Error during project creation: {e}")

        # Check if we have multiple projects
        cards = await page.query_selector_all('.project-card')
        print(f"Number of project cards: {len(cards)}")

        # Capture screenshot
        screenshot_path = '/home/jules/verification/landing_page_refinement.png'
        await page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        # Verify grid layout (3 columns)
        grid = await page.query_selector('.project-grid')
        grid_style = await grid.evaluate('el => getComputedStyle(el).gridTemplateColumns')
        print(f"Grid template columns: {grid_style}")

        # Check card height
        if len(cards) > 0:
            card_height = await cards[0].evaluate('el => el.offsetHeight')
            print(f"Card height: {card_height}px")

        # Check font-family
        body_font = await page.evaluate('getComputedStyle(document.body).fontFamily')
        print(f"Body font-family: {body_font}")

        await browser.close()

    server_process.terminate()

if __name__ == "__main__":
    asyncio.run(verify_landing_page())
