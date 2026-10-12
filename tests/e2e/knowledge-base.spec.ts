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
const email = `scholarflow.e2e.${runId}@example.com`;
const password = `E2e-${runId}!`;
const courseTitle = `Evidence Systems ${runId.slice(0, 8)}`;
let userId: string | undefined;

test.setTimeout(120_000);

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Chrome E2E" },
  });
  if (error || !data.user)
    throw error ?? new Error("Test user was not created.");
  userId = data.user.id;
});

test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test("creates a course and opens its knowledge workspace in Chrome", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: /Good to see you, Chrome/i }),
  ).toBeVisible();

  await page.getByLabel("Course code").fill("E2E101");
  await page.getByLabel("Course title").fill(courseTitle);
  await page.getByRole("button", { name: "Create course" }).click();
  await expect(page.getByRole("status")).toHaveText("Course created.");

  await page.getByRole("link", { name: new RegExp(courseTitle) }).click();
  await expect(page).toHaveURL(/\/dashboard\/courses\/.+\/knowledge$/);
  await expect(
    page.getByRole("heading", { name: `${courseTitle} knowledge base` }),
  ).toBeVisible();
  await expect(page.getByLabel("Course material")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Upload material" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Search a concept, theory, or term…"),
  ).toBeVisible();
  await expect(page.getByText("No course material yet")).toBeVisible();

  await page.getByLabel("Course material").setInputFiles({
    name: "triangulation-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Epistemic triangulation compares independent evidence sources before accepting a conclusion. Researchers should record disagreements and limitations.",
    ),
  });
  await page.getByRole("button", { name: "Upload material" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Document indexed into" }),
  ).toContainText("Document indexed into", { timeout: 30_000 });
  await expect(page.getByText("triangulation-notes.txt")).toBeVisible();
  await expect(page.getByText(/\d+ B · \d+ searchable chunks?/)).toBeVisible();

  await page
    .getByPlaceholder("Search a concept, theory, or term…")
    .fill("epistemic triangulation");
  await page.getByRole("button", { name: "Search evidence" }).click();
  await expect(page).toHaveURL(/\?q=epistemic\+triangulation$/);
  await expect(
    page.getByText(/compares independent evidence sources/i),
  ).toBeVisible();
  if (process.env.E2E_EXPECT_HYBRID === "1") {
    await expect(
      page.getByText(/Hybrid retrieval · nomic-embed-text/i),
    ).toBeVisible();
  }

  await page.screenshot({
    path: "test-results/knowledge-base-chrome.png",
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: `${courseTitle} knowledge base` }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/knowledge-base-chrome-mobile.png",
    fullPage: true,
  });
  expect(browserErrors).toEqual([]);
});
