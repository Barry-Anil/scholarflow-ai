import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

// Requires the agent worker running this commit against the same database, so
// Agent C research completes and records its stage events.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error("Hosted Supabase E2E credentials are not configured.");
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const runId = randomUUID();
const email = `scholarflow.monitor.${runId}@example.com`;
const password = `Monitor-${runId}!`;
const courseTitle = `Monitor Course ${runId.slice(0, 8)}`;
const assignmentTitle = `Monitor Essay ${runId.slice(0, 8)}`;
let userId: string | undefined;

test.setTimeout(180_000);

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Monitor E2E" },
  });
  if (error || !data.user) {
    throw error ?? new Error("Test user was not created.");
  }
  userId = data.user.id;
});

test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test("monitors a real Agent C run and traces draft provenance", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByLabel("Course code").fill("MON101");
  await page.getByLabel("Course title").fill(courseTitle);
  await page.getByRole("button", { name: "Create course" }).click();
  await page.getByRole("link", { name: new RegExp(courseTitle) }).click();
  await expect(page).toHaveURL(/\/courses\/[0-9a-f-]+\/knowledge$/);
  const courseId = page.url().match(/courses\/([0-9a-f-]+)\/knowledge/)?.[1];
  if (!courseId || !userId) throw new Error("Course context was not created.");
  const { data: evidenceDocument, error: documentError } = await admin
    .from("documents")
    .insert({
      owner_id: userId,
      course_id: courseId,
      original_filename: "monitor-evidence.txt",
      mime_type: "text/plain",
      size_bytes: 200,
      storage_path: `${userId}/${courseId}/monitor-evidence.txt`,
      sha256: runId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      status: "ready",
      extracted_text: "Tokenisation splits text into units for analysis.",
      extraction_metadata: {},
      processed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (documentError || !evidenceDocument) {
    throw documentError ?? new Error("Evidence document was not created.");
  }
  const { error: chunkError } = await admin.from("document_chunks").insert({
    document_id: evidenceDocument.id,
    owner_id: userId,
    course_id: courseId,
    chunk_index: 0,
    content: "Tokenisation splits text into units such as words for analysis.",
    metadata: {},
  });
  if (chunkError) throw chunkError;

  await page.getByRole("link", { name: "Assignments" }).click();
  await page.getByLabel("Assignment title").fill(assignmentTitle);
  await page
    .getByLabel("Assignment brief")
    .fill(
      "Question 1. Explain tokenisation (300 words)\n- Use course readings",
    );
  await page
    .getByLabel("Marking rubric")
    .fill("Accuracy (60%) - Correct claims\nClarity (40%) - Coherent argument");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(/\/assignments\/[0-9a-f-]+$/, {
    timeout: 30_000,
  });

  const trigger = page.getByTestId("agent-monitor-trigger");
  await expect(trigger).toHaveAccessibleName(/Status: Idle/);

  await page.getByRole("button", { name: "Run Agent C research" }).click();
  await expect(trigger).toHaveAccessibleName(/Status: (Waiting|Running)/);

  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Agent monitor" });
  await expect(dialog).toBeVisible();
  const agentC = dialog.getByRole("article", { name: "Agent C Research" });
  await expect(
    agentC.getByRole("progressbar", { name: "Agent C progress" }),
  ).toHaveAttribute("aria-valuenow", "100", { timeout: 60_000 });
  await expect(
    dialog.getByText(/Keyword retrieval returned \d+ course passages?/).first(),
  ).toBeVisible();
  await expect(
    dialog.getByText(/started question 1 \(attempt 1 of/).first(),
  ).toBeVisible();

  await dialog.getByRole("tab", { name: "System" }).click();
  await expect(dialog.getByText("Ollama connectivity")).toBeVisible();
  await expect(dialog.getByText("Background worker")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page
    .getByLabel("Draft answer (Markdown)")
    .first()
    .fill("Tokenisation splits text into words for analysis.");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByRole("status").first()).toContainText(
    "Draft saved as version 1",
  );

  await trigger.click();
  await dialog.getByRole("tab", { name: "Changes & Evaluation" }).click();
  await expect(dialog.getByText("Saved by a person").first()).toBeVisible();
  await expect(dialog.getByText(/Not evaluated/)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(browserErrors).toEqual([]);
});
