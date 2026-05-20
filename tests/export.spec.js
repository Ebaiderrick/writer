/**
 * E2E: Export validation tests.
 * Verifies that export UI is present and DOCX download can be triggered.
 */
import { test, expect } from "@playwright/test";
import { login } from "./helper.js";

async function openStudioWithContent(page) {
  await login(page);
  await page.click("#newProjectBtn");
  await expect(page.locator("#studioView")).toBeVisible({ timeout: 10000 });

  // Add some content
  const block = page.locator(".script-block").first();
  await block.waitFor({ state: "visible" });
  await block.click();
  await page.keyboard.type("INT. TEST SCENE - DAY");
}

async function openOutputMenu(page) {
  const outputBtn = page.locator('[data-studio-nav="output"]');
  await outputBtn.waitFor({ state: "visible", timeout: 8000 });
  await outputBtn.click();
}

test.describe("Export menu", () => {
  test("Output menu button exists in studio nav", async ({ page }) => {
    await openStudioWithContent(page);
    const outputBtn = page.locator('[data-studio-nav="output"]');
    await expect(outputBtn).toBeVisible({ timeout: 8000 });
  });

  test("Output menu opens on click", async ({ page }) => {
    await openStudioWithContent(page);
    await openOutputMenu(page);
    // A menu or panel should appear
    const menu = page.locator(".nav-menu, [data-studio-nav-panel='output']");
    await expect(menu.first()).toBeVisible({ timeout: 5000 });
  });

  test("DOCX export option is present", async ({ page }) => {
    await openStudioWithContent(page);
    await openOutputMenu(page);
    const docxBtn = page.locator(
      '[data-menu-action="export-word"], [data-menu-action="export-docx"], button:has-text("Word")'
    );
    await expect(docxBtn.first()).toBeVisible({ timeout: 5000 });
  });

  test("PDF export option is present", async ({ page }) => {
    await openStudioWithContent(page);
    await openOutputMenu(page);
    const pdfBtn = page.locator(
      '[data-menu-action="export-pdf"], button:has-text("PDF")'
    );
    await expect(pdfBtn.first()).toBeVisible({ timeout: 5000 });
  });

  test("DOCX export triggers a download", async ({ page }) => {
    await openStudioWithContent(page);
    await openOutputMenu(page);

    const docxBtn = page.locator(
      '[data-menu-action="export-word"], [data-menu-action="export-docx"], button:has-text("Word")'
    ).first();
    await docxBtn.waitFor({ state: "visible", timeout: 5000 });

    // Listen for download event
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10000 }),
      docxBtn.click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.docx$/i);
  });
});
