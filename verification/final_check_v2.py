from playwright.sync_api import sync_playwright, expect
import os

def run(page):
    path = os.path.abspath("index.html")
    page.goto("http://localhost:8001/index.html")
    page.click("#newProjectBtn")
    page.wait_for_selector("#studioView", state="visible")

    # Check if activeModeLabel is empty and hidden
    is_hidden = page.evaluate('getComputedStyle(document.getElementById("activeModeLabel")).display === "none"')
    text = page.evaluate('document.getElementById("activeModeLabel").textContent')
    print(f"activeModeLabel hidden: {is_hidden}, text: '{text}'")

    page.screenshot(path="verification/studio_no_pill.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        run(page)
        browser.close()
