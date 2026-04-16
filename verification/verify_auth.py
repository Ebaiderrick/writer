from playwright.sync_api import sync_playwright, expect
import os

def verify(page):
    path = os.path.abspath("index.html")
    page.goto(f"file://{path}")

    # Check for Auth View
    expect(page.locator("#authView")).to_be_visible()
    page.screenshot(path="verification/auth_start.png")

    # Simulate successful login and reload
    page.evaluate('localStorage.setItem("eyawriter_session", "logged-in")')
    page.reload()

    # Check for Home view
    # expect(page.locator("#homeView")).to_be_visible() # Might be hidden if JS failed
    page.screenshot(path="verification/after_auth_reload.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        verify(page)
        browser.close()
