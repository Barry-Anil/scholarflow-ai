import { randomUUID } from "node:crypto";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.TEST_DATABASE_URL;
const supabaseUrl = process.env.TEST_SUPABASE_URL;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

if (!databaseUrl || !supabaseUrl || !serviceRoleKey) {
  throw new Error("Local Supabase integration environment is required.");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const admin: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let owner: User;
let outsider: User;
let editor: User;
let viewer: User;

async function createTestUser(label: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}-${randomUUID()}@example.test`,
    password: `Test-${randomUUID()}-Aa1!`,
    email_confirm: true,
  });
  if (error || !data.user)
    throw error ?? new Error("Test user was not created.");
  return data.user;
}

async function asAuthenticated<T>(
  userId: string,
  operation: (tx: postgres.TransactionSql) => Promise<T>,
) {
  return sql.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    await tx`select set_config('request.jwt.claim.role', 'authenticated', true)`;
    return operation(tx);
  });
}

beforeAll(async () => {
  owner = await createTestUser("owner");
  outsider = await createTestUser("outsider");
  editor = await createTestUser("editor");
  viewer = await createTestUser("viewer");
});

afterAll(async () => {
  if (owner) await admin.auth.admin.deleteUser(owner.id);
  if (outsider) await admin.auth.admin.deleteUser(outsider.id);
  if (editor) await admin.auth.admin.deleteUser(editor.id);
  if (viewer) await admin.auth.admin.deleteUser(viewer.id);
  await sql.end();
});

describe("live Supabase foundation", () => {
  it("has RLS enabled with policies on every application table", async () => {
    const rows = await sql<
      { table_name: string; rls_enabled: boolean; policy_count: number }[]
    >`
      select c.relname as table_name,
             c.relrowsecurity as rls_enabled,
             count(p.policyname)::int as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
      where n.nspname = 'public'
        and c.relname in (
          'profiles', 'courses', 'course_members', 'documents', 'document_chunks',
          'processing_jobs', 'assignments', 'assignment_questions', 'rubric_criteria',
          'agent_runs', 'agent_run_events', 'assignment_drafts', 'draft_answers',
          'answer_citations', 'research_findings', 'review_reports', 'review_findings',
          'draft_approvals', 'revision_history', 'usage_records', 'export_records',
          'rate_limit_counters'
        )
      group by c.relname, c.relrowsecurity
    `;
    expect(rows).toHaveLength(22);
    expect(rows.every((row) => row.rls_enabled)).toBe(true);
    expect(
      rows
        .filter((row) => row.table_name !== "rate_limit_counters")
        .every((row) => row.policy_count > 0),
    ).toBe(true);
    expect(
      rows.find((row) => row.table_name === "rate_limit_counters")
        ?.policy_count,
    ).toBe(0);
  });

  it("keeps a course invisible to a different authenticated user", async () => {
    const courseId = randomUUID();
    await asAuthenticated(
      owner.id,
      (tx) =>
        tx`insert into public.courses (id, owner_id, title) values (${courseId}, ${owner.id}, 'RLS test')`,
    );

    const ownRows = await asAuthenticated(
      owner.id,
      (tx) =>
        tx<
          { id: string }[]
        >`select id from public.courses where id = ${courseId}`,
    );
    const outsiderRows = await asAuthenticated(
      outsider.id,
      (tx) =>
        tx<
          { id: string }[]
        >`select id from public.courses where id = ${courseId}`,
    );
    expect(ownRows).toHaveLength(1);
    expect(outsiderRows).toHaveLength(0);
  });

  it("rejects an authenticated insert that impersonates another owner", async () => {
    await expect(
      asAuthenticated(
        outsider.id,
        (tx) =>
          tx`insert into public.courses (owner_id, title) values (${owner.id}, 'Forbidden')`,
      ),
    ).rejects.toThrow();
  });

  it("enforces owner, editor, viewer, and outsider course permissions", async () => {
    const courseId = randomUUID();
    const assignmentId = randomUUID();
    try {
      await asAuthenticated(
        owner.id,
        (tx) =>
          tx`insert into public.courses (id, owner_id, title) values (${courseId}, ${owner.id}, 'Collaboration RLS test')`,
      );
      await sql`
        insert into public.course_members (course_id, user_id, role)
        values
          (${courseId}, ${editor.id}, 'editor'),
          (${courseId}, ${viewer.id}, 'viewer')
      `;

      await asAuthenticated(
        editor.id,
        (tx) =>
          tx`insert into public.assignments (id, course_id, owner_id, title, brief_markdown) values (${assignmentId}, ${courseId}, ${editor.id}, 'Editor assignment', 'Brief')`,
      );

      const viewerRows = await asAuthenticated(
        viewer.id,
        (tx) =>
          tx<
            { id: string }[]
          >`select id from public.assignments where id = ${assignmentId}`,
      );
      const outsiderRows = await asAuthenticated(
        outsider.id,
        (tx) =>
          tx<
            { id: string }[]
          >`select id from public.assignments where id = ${assignmentId}`,
      );
      expect(viewerRows).toHaveLength(1);
      expect(outsiderRows).toHaveLength(0);

      const viewerUpdate = await asAuthenticated(
        viewer.id,
        (tx) =>
          tx`update public.assignments set title = 'Forbidden viewer edit' where id = ${assignmentId} returning id`,
      );
      expect(viewerUpdate).toHaveLength(0);
      await expect(
        asAuthenticated(
          editor.id,
          (tx) =>
            tx`insert into public.course_members (course_id, user_id, role) values (${courseId}, ${outsider.id}, 'viewer')`,
        ),
      ).rejects.toThrow();

      await asAuthenticated(
        editor.id,
        (tx) =>
          tx`update public.assignments set title = 'Editor updated' where id = ${assignmentId}`,
      );
      const [updated] = await sql<{ title: string }[]>`
        select title from public.assignments where id = ${assignmentId}
      `;
      expect(updated?.title).toBe("Editor updated");
    } finally {
      await sql`delete from public.courses where id = ${courseId}`;
    }
  });

  it("creates a private size-limited course-materials bucket", async () => {
    const [bucket] = await sql<{ public: boolean; file_size_limit: number }[]>`
      select public, file_size_limit::int as file_size_limit
      from storage.buckets
      where id = 'course-materials'
    `;
    expect(bucket).toEqual({ public: false, file_size_limit: 26_214_400 });
  });
});
