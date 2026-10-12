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
const email = `scholarflow.assignment.${runId}@example.com`;
const password = `Assignment-${runId}!`;
const courseTitle = `Structured Writing ${runId.slice(0, 8)}`;
const assignmentTitle = `Critical Essay ${runId.slice(0, 8)}`;
let userId: string | undefined;

test.setTimeout(150_000);

test.beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Assignment E2E" },
  });
  if (error || !data.user) {
    throw error ?? new Error("Test user was not created.");
  }
  userId = data.user.id;
});

test.afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test("creates, structures, and versions an assignment draft in Chrome", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByLabel("Course code").fill("WRITE201");
  await page.getByLabel("Course title").fill(courseTitle);
  await page.getByRole("button", { name: "Create course" }).click();
  await expect(page.getByRole("status")).toHaveText("Course created.");
  await page.getByRole("link", { name: new RegExp(courseTitle) }).click();
  await expect(page).toHaveURL(/\/courses\/[0-9a-f-]+\/knowledge$/);
  const courseId = page.url().match(/courses\/([0-9a-f-]+)\/knowledge/)?.[1];
  if (!courseId || !userId) throw new Error("Course context was not created.");
  const { data: evidenceDocument, error: documentError } = await admin
    .from("documents")
    .insert({
      owner_id: userId,
      course_id: courseId,
      original_filename: "agent-evidence.txt",
      mime_type: "text/plain",
      size_bytes: 300,
      storage_path: `${userId}/${courseId}/agent-evidence.txt`,
      sha256: runId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      status: "ready",
      extracted_text:
        "The central theory explains how institutions shape social meaning. A case study applies the theory to institutional practice and counterarguments.",
      extraction_metadata: {},
      processed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (documentError || !evidenceDocument) {
    throw documentError ?? new Error("Evidence document was not created.");
  }
  const { error: chunkError } = await admin.from("document_chunks").insert([
    {
      document_id: evidenceDocument.id,
      owner_id: userId,
      course_id: courseId,
      chunk_index: 0,
      content:
        "The central theory explains how institutions shape social meaning and how two perspectives disagree about the mechanism.",
      metadata: {},
    },
    {
      document_id: evidenceDocument.id,
      owner_id: userId,
      course_id: courseId,
      chunk_index: 1,
      content:
        "A case study applies the theory to institutional practice and evaluates a counterargument using observed evidence.",
      metadata: {},
    },
  ]);
  if (chunkError) throw chunkError;
  await page.getByRole("link", { name: "Assignments" }).click();
  await expect(page).toHaveURL(/\/assignments$/);

  await page.getByLabel("Assignment title").fill(assignmentTitle);
  await page
    .getByLabel("Assignment brief")
    .fill(
      "Question 1. Explain the central theory (500 words)\n- Use two course readings\n\nQuestion 2. Apply the theory to a case study (800 words)\n- Address one counterargument",
    );
  await page
    .getByLabel("Marking rubric")
    .fill(
      "Critical analysis (40%) - Evaluates competing views\nUse of evidence (35%) - Integrates course sources\nClarity (25%) - Presents a coherent argument",
    );
  await page.getByRole("button", { name: "Create workspace" }).click();

  await expect(page).toHaveURL(/\/assignments\/[0-9a-f-]+$/, {
    timeout: 30_000,
  });
  const assignmentId = page.url().match(/assignments\/([0-9a-f-]+)$/)?.[1];
  if (!assignmentId) throw new Error("Assignment context was not created.");
  await expect(
    page.getByRole("heading", { name: assignmentTitle }),
  ).toBeVisible();
  await expect(page.getByText("2 questions")).toBeVisible();
  await expect(page.getByText("3 rubric criteria")).toBeVisible();
  await expect(page.getByText("Critical analysis")).toBeVisible();
  await expect(page.getByText("40%")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run Agent C research" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run Agent C research" }).click();
  await expect(
    page.getByText("Agent C completed research. Review the saved evidence."),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("agent-evidence.txt").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate Agent B draft" }),
  ).toBeEnabled();
  await expect(
    page.getByText(/Agent C completed research with \d+ traceable sources?\./),
  ).toBeVisible();

  const answers = page.getByLabel("Draft answer (Markdown)");
  await answers
    .nth(0)
    .fill(
      "The central theory argues that meaning is socially produced (Author, 2024).",
    );
  await answers
    .nth(1)
    .fill(
      "The case study demonstrates how institutions reinforce that meaning.",
    );
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Draft saved as version 1",
  );

  await page.reload();
  await expect(page.getByText("Draft version 1")).toBeVisible();
  await expect(answers.nth(0)).toHaveValue(/socially produced/);
  await expect(
    page.getByRole("button", { name: "Run Agent A review" }),
  ).toBeEnabled();
  await answers
    .nth(0)
    .fill(
      "The revised argument ties social production directly to the course evidence (Author, 2024).",
    );
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Draft saved as version 2",
  );

  const { data: latestDraft, error: draftLookupError } = await admin
    .from("assignment_drafts")
    .select("id")
    .eq("assignment_id", assignmentId)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  if (draftLookupError || !latestDraft) {
    throw draftLookupError ?? new Error("Latest draft was not found.");
  }
  const { data: answer, error: answerLookupError } = await admin
    .from("draft_answers")
    .select("id")
    .eq("draft_id", latestDraft.id)
    .limit(1)
    .single();
  if (answerLookupError || !answer) {
    throw answerLookupError ?? new Error("Draft answer was not found.");
  }
  const { data: report, error: reportError } = await admin
    .from("review_reports")
    .insert({
      assignment_id: assignmentId,
      draft_id: latestDraft.id,
      owner_id: userId,
      overall_status: "changes_required",
      requires_another_cycle: true,
      unresolved_concerns: ["Add a counterargument."],
      quality_gate_results: { passed: false, requiredFindings: 1 },
    })
    .select("id")
    .single();
  if (reportError || !report) {
    throw reportError ?? new Error("Review report was not created.");
  }
  const { error: findingError } = await admin.from("review_findings").insert({
    report_id: report.id,
    answer_id: answer.id,
    severity: "major",
    required: true,
    title: "Develop the counterargument",
    explanation: "The answer does not address the strongest objection.",
    recommended_correction: "Add and evaluate one supported counterargument.",
  });
  if (findingError) throw findingError;

  await page.reload();
  await expect(page.getByText("Develop the counterargument")).toBeVisible();
  await page
    .getByPlaceholder("Optional note for Agent B")
    .fill("Keep the revision concise.");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Finding accepted.");
  await expect(page.getByText("accepted", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Revise accepted findings" }),
  ).toBeEnabled();

  const { error: passingReviewError } = await admin
    .from("review_reports")
    .update({
      overall_status: "quality_gates_passed",
      requires_another_cycle: false,
      unresolved_concerns: [],
      quality_gate_results: { passed: true, requiredFindings: 0 },
    })
    .eq("id", report.id);
  if (passingReviewError) throw passingReviewError;
  const { error: citationError } = await admin.from("answer_citations").insert({
    answer_id: answer.id,
    source_type: "course_material",
    source_id: evidenceDocument.id,
    claim_text: "Course evidence supports the central theory.",
    locator: "Passage 1",
    metadata: { title: "agent-evidence.txt" },
    verified: true,
  });
  if (citationError) throw citationError;

  await page.reload();
  await expect(
    page.getByText("Every stored citation is verified"),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Approve this version" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Draft approved. Secure exports are now available.",
  );
  await expect(page.getByText("Draft version 2 approved")).toBeVisible();

  await page.getByRole("button", { name: "MD", exact: true }).click();
  await expect(
    page.getByText("Export completed. A secure download is ready.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });
  const downloadLink = page.getByRole("link", {
    name: /Download .*\.md/,
  });
  await expect(downloadLink).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-v2\.md$/);

  await page.screenshot({
    path: "test-results/assignment-workspace-chrome.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/assignment-workspace-chrome-mobile.png",
    fullPage: true,
  });
  expect(browserErrors).toEqual([]);
});
