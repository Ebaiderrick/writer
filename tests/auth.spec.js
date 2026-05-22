/**
 * E2E: Authentication page
 * Tests the auth page without any mock session (unauthenticated state).
 */
import { test, expect } from "@playwright/test";

test.describe("Auth page", () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing session so we see the auth page
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
  });

  test("auth view is visible on cold load", async ({ page }) => {
    await expect(page.locator("#authView")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#homeView")).toBeHidden();
  });

  test("login form is present and has required fields", async ({ page }) => {
    await expect(page.locator("#authView")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#login-email")).toBeVisible();
    await expect(page.locator("#login-pass")).toBeVisible();
    await expect(page.locator("#login-form button[type=submit]")).toBeVisible();
  });

  test("signup tab switches to signup form", async ({ page }) => {
    await expect(page.locator("#authView")).toBeVisible({ timeout: 10000 });
    await page.click('[data-tab="signup"]');
    await expect(page.locator("#signup-form")).toBeVisible();
    await expect(page.locator("#signup-name")).toBeVisible();
    await expect(page.locator("#signup-email")).toBeVisible();
    await expect(page.locator("#signup-pass")).toBeVisible();
    await expect(page.locator("#signup-pass2")).toBeVisible();
  });

  test("login tab is active by default", async ({ page }) => {
    await expect(page.locator("#authView")).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-tab="login"]')).toHaveClass(/active/);
    await expect(page.locator("#login-form")).toBeVisible();
  });

  test("Google sign-in button is present", async ({ page }) => {
    await expect(page.locator("#authView")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#google-signin")).toBeVisible();
  });

  test("demo account button is present", async ({ page }) => {
    await expect(page.locator("#authView")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#demo-login-btn")).toBeVisible();
  });

  test("forgot password link is present", async ({ page }) => {
    await expect(page.locator("#authView")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#forgot-password-link")).toBeVisible();
  });

  test("password hint is shown in signup form", async ({ page }) => {
    await expect(page.locator("#authView")).toBeVisible({ timeout: 10000 });
    await page.click('[data-tab="signup"]');
    await expect(page.locator(".input-hint")).toBeVisible();
  });
});
