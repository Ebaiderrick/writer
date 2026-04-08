import asyncio
from playwright.async_api import async_playwright
import os
import subprocess
import time

async def verify_continuous_editor():
    # Start server
    server_process = subprocess.Popen(['python3', '-m', 'http.server', '8082'])
    time.sleep(2)

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()

        await page.goto('http://localhost:8082/index.html')

        # Open first project
        await page.click('.project-card-open')
        await page.wait_for_selector('.screenplay-editor')

        # Type content
        editor = page.locator('.screenplay-editor')
        first_block = editor.locator('.script-block').first
        await first_block.click()
        await page.keyboard.type('EXT. DESERT - DAY')
        await page.keyboard.press('Enter')

        # Verify a new block is created
        blocks_count = await editor.locator('.script-block').count()
        print(f"Blocks count after Enter: {blocks_count}")

        # Verify normalization (Auto caps)
        text = await first_block.text_content()
        print(f"First block text: {text}")

        # Backspace on empty block
        await page.keyboard.press('Backspace')
        blocks_count = await editor.locator('.script-block').count()
        print(f"Blocks count after Backspace: {blocks_count}")

        await browser.close()

    server_process.terminate()

if __name__ == "__main__":
    asyncio.run(verify_continuous_editor())
