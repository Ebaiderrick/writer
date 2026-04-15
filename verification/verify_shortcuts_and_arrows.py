from playwright.sync_api import sync_playwright, expect
import os

def verify(page):
    path = os.path.abspath("index.html")
    page.goto(f"file://{path}")

    # 1. Open Studio
    page.locator("#newProjectBtn").click()
    expect(page.locator("#studioView")).to_be_visible()

    # 2. Check Arrow symbols in index.html
    left_arrow = page.evaluate('document.getElementById("leftRailToggle").textContent')
    print(f"Left rail arrow: {left_arrow}")
    assert left_arrow == "◀"

    right_arrow = page.evaluate('document.getElementById("rightRailToggle").textContent')
    print(f"Right arrow: {right_arrow}")
    assert right_arrow == "▶"

    # 3. Check AI button arrow (Use JS to force render if needed)
    page.locator("#aiAssistToggle").check()
    # Trigger AI Assistant logic
    page.evaluate('AI.init()')

    # Check if a block row exists
    rows = page.evaluate('document.querySelectorAll(".script-block-row").length')
    print(f"Number of rows: {rows}")

    if rows == 0:
        # Manually add a line to the project if it's empty
        page.evaluate('''
            const project = state.projects.find(p => p.id === state.currentProjectId);
            project.lines.push({id: "test-id", type: "action", text: "Test line"});
            renderStudio();
        ''')

    # Hover or force button
    page.evaluate('''
        const row = document.querySelector(".script-block-row");
        row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        const btn = row.querySelector(".ai-btn");
        if (btn) btn.click();
    ''')

    # Wait for AI menu
    page.wait_for_selector(".ai-menu", timeout=5000)
    page.locator(".ai-menu-item").first.click()

    # Check submit button arrow
    submit_arrow = page.evaluate('document.querySelector(".ai-submit-btn").textContent')
    print(f"AI submit arrow: {submit_arrow}")
    assert submit_arrow == "▶"

    page.screenshot(path="verification/ai_menu_arrow.png")

    # 4. Check Shortcuts help modal
    page.locator("#helpBtn").click()
    help_text = page.evaluate('document.getElementById("helpDialog").textContent')
    print(f"Help dialog contains ▲ / ▼: {'▲ / ▼' in help_text}")
    assert '▲ / ▼' in help_text

    page.screenshot(path="verification/shortcuts_modal.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()
        try:
            verify(page)
        finally:
            browser.close()
