/**
 * Playwright: billing UI smoke tests.
 * Verifies plan comparison table and billing settings render correctly.
 */
import { test, expect } from "@playwright/test";
import { login } from "./helper.js";

test.describe("Billing settings", () => {
  async function openBilling(page) {
    await login(page);
    await page.click(".open-settings-btn");
    await expect(page.locator("#settingsView")).toBeVisible({ timeout: 8000 });
    await page.click('[data-settings-tab="billing"]');
    await expect(
      page.locator('[data-settings-section="billing"]')
    ).toBeVisible({ timeout: 8000 });
  }

  test("billing tab is present and clickable", async ({ page }) => {
    await login(page);
    await page.click(".open-settings-btn");
    await expect(
      page.locator('[data-settings-tab="billing"]')
    ).toBeVisible({ timeout: 8000 });
  });

  test("billing section shows current plan", async ({ page }) => {
    await openBilling(page);
    await expect(page.locator("#billingCurrentPlan")).toBeVisible();
  });

  test("plan comparison table is present", async ({ page }) => {
    await openBilling(page);
    const details = page.locator(".plan-compare-details");
    await expect(details).toBeVisible();
    // Expand it
    await page.click(".plan-compare-summary");
    await expect(page.locator(".plan-compare-table")).toBeVisible();
  });

  test("free section is visible for non-subscriber", async ({ page }) => {
    await openBilling(page);
    await expect(page.locator("#billingFreeSection")).toBeVisible();
    await expect(page.locator("#billingProSection")).toBeHidden();
  });

  test("upgrade button is present for free users", async ({ page }) => {
    await openBilling(page);
    await expect(page.locator("#billingUpgradeBtn")).toBeVisible();
  });
});
