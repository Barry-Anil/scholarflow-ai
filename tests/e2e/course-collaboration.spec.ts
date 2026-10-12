import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type User } from "@supabase/supabase-js";
import { expect, test, type Browser } from "@playwright/test";
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
const password = `Collaboration-${runId}!`;
const courseTitle = `Shared Evidence ${runId.slice(0, 8)}`;
const baseURL = `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_PORT ?? 3100)}`;
const users: User[] = [];
let courseId: string | undefined;

async function createUser(role: string) {
  const email = `scholarflow.${role}.${runId}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: `${role} E2E` },
  });
  if (error || !data.user)
    throw error ?? new Error(`${role} user was not created.`);
  users.push(data.user);
  return { email, user: data.user };
}

async function signIn(browser: Browser, email: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return { context, page };
}

test.setTimeout(120_000);

test.afterAll(async () => {
  if (courseId) await admin.from("courses").delete().eq("id", courseId);
  for (const user of users) await admin.auth.admin.deleteUser(user.id);
});

test("owner manages members while editor and viewer receive bounded access", async ({
  browser,
}) => {
  const owner = await createUser("owner");
  const editor = await createUser("editor");
  const viewer = await createUser("viewer");

  const ownerSession = await signIn(browser, owner.email);
  await ownerSession.page.getByLabel("Course code").fill("SHARE101");
  await ownerSession.page.getByLabel("Course title").fill(courseTitle);
  await ownerSession.page
    .getByRole("button", { name: "Create course" })
    .click();
  await ownerSession.page
    .getByRole("link", { name: new RegExp(courseTitle) })
    .click();
  await expect(ownerSession.page).toHaveURL(
    /\/dashboard\/courses\/[0-9a-f-]+\/knowledge$/,
  );
  courseId = new URL(ownerSession.page.url()).pathname.split("/")[3];
  await ownerSession.page.getByRole("link", { name: "Members" }).click();
  const addMemberForm = ownerSession.page.locator("form").filter({
    has: ownerSession.page.getByRole("button", { name: "Add member" }),
  });

  await ownerSession.page.getByLabel("Registered email").fill(editor.email);
  await addMemberForm.locator('select[name="role"]').selectOption("editor");
  await ownerSession.page.getByRole("button", { name: "Add member" }).click();
  await expect(ownerSession.page.getByRole("status")).toContainText(
    "now has editor access",
  );

  await ownerSession.page.getByLabel("Registered email").fill(viewer.email);
  await addMemberForm.locator('select[name="role"]').selectOption("viewer");
  await ownerSession.page.getByRole("button", { name: "Add member" }).click();
  await expect(ownerSession.page.getByRole("status")).toContainText(
    "now has viewer access",
  );
  await ownerSession.context.close();

  const editorSession = await signIn(browser, editor.email);
  await editorSession.page
    .getByRole("link", { name: new RegExp(courseTitle) })
    .click();
  await expect(editorSession.page).toHaveURL(
    new RegExp(`/dashboard/courses/${courseId}/knowledge$`),
  );
  await expect(editorSession.page.getByLabel("Course material")).toBeVisible();
  await editorSession.page.getByRole("link", { name: "Members" }).click();
  await expect(
    editorSession.page.getByRole("heading", { name: `${courseTitle} members` }),
  ).toBeVisible();
  await expect(
    editorSession.page.getByRole("heading", { name: "Add or update a member" }),
  ).toHaveCount(0);
  await editorSession.context.close();

  const viewerSession = await signIn(browser, viewer.email);
  await viewerSession.page
    .getByRole("link", { name: new RegExp(courseTitle) })
    .click();
  await expect(
    viewerSession.page.getByRole("heading", {
      name: `${courseTitle} knowledge base`,
    }),
  ).toBeVisible();
  await expect(viewerSession.page.getByLabel("Course material")).toHaveCount(0);
  await expect(
    viewerSession.page.getByRole("button", { name: "Upload material" }),
  ).toHaveCount(0);
  await viewerSession.page.getByRole("link", { name: "Members" }).click();
  await expect(viewerSession.page.getByText(viewer.email)).toBeVisible();
  await expect(
    viewerSession.page.getByRole("heading", { name: "Add or update a member" }),
  ).toHaveCount(0);
  await viewerSession.context.close();
});
