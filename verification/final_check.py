from playwright.sync_api import sync_playwright, expect
import time

def run(page):
    page.goto("http://localhost:8001/index.html")
    page.wait_for_load_state("networkidle")

    # 1. Open studio
    page.click("#newProjectBtn")
    page.wait_for_selector("#studioView", state="visible")

    # 2. Screenshots
    page.screenshot(path="verification/studio_full.png")

    # 3. Check Shortcuts
    page.click("#helpBtn")
    time.sleep(0.5)
    page.screenshot(path="verification/shortcuts_full.png")
    page.keyboard.press("Escape")

    # 4. Check AI
    page.check("#aiAssistToggle")
    page.click(".script-block")
    page.hover(".script-block-row")
    page.wait_for_selector(".ai-btn", state="visible")
    page.click(".ai-btn")
    page.wait_for_selector(".ai-menu", state="visible")
    page.click(".ai-menu-item:has-text('Visualize')")
    time.sleep(0.2)
    page.screenshot(path="verification/ai_flow_full.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        try:
            run(page)
        finally:
            browser.close()
