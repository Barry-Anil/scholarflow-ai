import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("Hosted Supabase E2E credentials are not configured.");
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const runId = randomUUID();
const email = `scholarflow.navigation.${runId}@example.com`;
const password = `Navigation-${runId}!`;
let userId: string | undefined;

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Navigation E2E" },
  });
  if (error || !data.user) {
    throw error ?? new Error("Test user was not created.");
  }
  userId = data.user.id;
});

test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test("opens every workspace destination from the sidebar", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const destinations = [
    ["Courses", "/dashboard/courses", "Courses"],
    ["Knowledge base", "/dashboard/knowledge", "Knowledge base"],
    ["Agent activity", "/dashboard/activity", "Agent activity"],
    ["Review center", "/dashboard/reviews", "Review center"],
    ["Settings", "/dashboard/settings", "Settings"],
    ["Overview", "/dashboard", /Good to see you/],
  ] as const;

  for (const [label, pathName, heading] of destinations) {
    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("link", { name: label })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${pathName.replaceAll("/", "\\/")}$`),
    );
    await expect(
      page.getByRole("heading", { level: 1, name: heading, exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Workspace navigation" })
        .getByRole("link", { name: label }),
    ).toHaveAttribute("aria-current", "page");
  }
});
