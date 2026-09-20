import { test, expect } from "@playwright/test";

test("admin can log in and reach the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("admin@coastaleats.test");
  await page.getByPlaceholder("Password").fill("admin123!");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Signed in as Alex Admin")).toBeVisible();
  // Scoped to <main>: the nav header also displays the role badge on every
  // page, so a bare getByText(role) is ambiguous between the two.
  await expect(page.getByRole("main").getByText("ADMIN", { exact: true })).toBeVisible();
});

test("wrong password is rejected and never reaches the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill("admin@coastaleats.test");
  await page.getByPlaceholder("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/login\?error=invalid/);
  // Scoped to <main>: the same message is also surfaced as a toast, so a
  // bare getByText matches both the persistent inline banner and the toast.
  await expect(page.getByRole("main").getByText("Invalid email or password.")).toBeVisible();
  await expect(page.getByText("Signed in as")).toHaveCount(0);
});

test("unauthenticated visitor to /dashboard is redirected to /login", async ({ browser }) => {
  // Fresh context with no storage state: no session cookie exists.
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Signed in as")).toHaveCount(0);

  await context.close();
});
