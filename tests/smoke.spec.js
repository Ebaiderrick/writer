/**
 * E2E: Critical-path smoke tests.
 * Covers the most important user flows end-to-end.
 */
import { test, expect } from "@playwright/test";
import { login } from "./helper.js";

// ── Home page ────────────────────────────────────────────────────────────────

test.describe("Home page", () => {
  test("loads after mock login", async ({ page }) => {
    await login(page);
    await expect(page.locator("#homeView")).toBeVisible();
    await expect(page.locator("#newProjectBtn")).toBeVisible();
  });

  test("project grid is visible", async ({ page }) => {
    await login(page);
    await expect(page.locator("#projectGrid")).toBeVisible();
  });

  test("user name is displayed in topbar", async ({ page }) => {
    await login(page);
    await expect(page.locator("#homeUserNameDisplay")).toBeVisible();
  });
});

// ── Project creation ─────────────────────────────────────────────────────────

test.describe("Project creation", () => {
  test("creates a new project and opens studio", async ({ page }) => {
    await login(page);
    await page.click("#newProjectBtn");
    await expect(page.locator("#studioView")).toBeVisible({ timeout: 10000 });
  });

  test("studio has an editable script block", async ({ page }) => {
    await login(page);
    await page.click("#newProjectBtn");
    await expect(page.locator(".script-block").first()).toBeVisible({ timeout: 10000 });
  });

  test("script block accepts text input", async ({ page }) => {
    await login(page);
    await page.click("#newProjectBtn");
    const block = page.locator(".script-block").first();
    await block.waitFor({ state: "visible", timeout: 10000 });
    await block.click();
    await page.keyboard.type("INT. COFFEE SHOP - DAY");
    await expect(block).toHaveText(/INT\. COFFEE SHOP/);
  });
});

// ── Settings ─────────────────────────────────────────────────────────────────

test.describe("Settings", () => {
  test("settings view opens from home", async ({ page }) => {
    await login(page);
    await page.click(".open-settings-btn");
    await expect(page.locator("#settingsView")).toBeVisible({ timeout: 8000 });
  });

  test("settings has General tab active by default", async ({ page }) => {
    await login(page);
    await page.click(".open-settings-btn");
    await expect(
      page.locator('[data-settings-section="general"]')
    ).toHaveClass(/is-active/, { timeout: 8000 });
  });

  test("settings back button returns to previous view", async ({ page }) => {
    await login(page);
    await page.click(".open-settings-btn");
    await expect(page.locator("#settingsView")).toBeVisible({ timeout: 8000 });
    await page.click("#settingsBackBtn");
    await expect(page.locator("#homeView")).toBeVisible();
    await expect(page.locator("#settingsView")).toBeHidden();
  });

  test("Support tab is present", async ({ page }) => {
    await login(page);
    await page.click(".open-settings-btn");
    await expect(
      page.locator('[data-settings-tab="support"]')
    ).toBeVisible({ timeout: 8000 });
  });
});

// ── Export menu ───────────────────────────────────────────────────────────────

test.describe("Export", () => {
  async function openStudio(page) {
    await login(page);
    await page.click("#newProjectBtn");
    await expect(page.locator("#studioView")).toBeVisible({ timeout: 10000 });
  }

  test("studio toolbar is visible", async ({ page }) => {
    await openStudio(page);
    await expect(page.locator(".studio-topbar")).toBeVisible();
  });

  test("studio has a nav with Output menu", async ({ page }) => {
    await openStudio(page);
    // Find a nav button that mentions Output or Export
    const outputBtn = page.locator('[data-studio-nav="output"], [data-studio-nav="export"]');
    await expect(outputBtn).toBeVisible({ timeout: 8000 });
  });
});

// ── Navigation ────────────────────────────────────────────────────────────────

test.describe("Navigation", () => {
  test("go-home button from studio returns to home", async ({ page }) => {
    await login(page);
    await page.click("#newProjectBtn");
    await expect(page.locator("#studioView")).toBeVisible({ timeout: 10000 });
    await page.locator("#goHomeBtn, [data-action='go-home']").first().click();
    await expect(page.locator("#homeView")).toBeVisible({ timeout: 8000 });
  });
});
