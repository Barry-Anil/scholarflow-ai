import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("drizzle/0001_supabase_security.sql"),
  "utf8",
);

const protectedTables = [
  "profiles",
  "courses",
  "course_members",
  "assignments",
  "assignment_questions",
  "rubric_criteria",
  "documents",
  "document_chunks",
  "processing_jobs",
  "agent_runs",
  "agent_run_events",
  "assignment_drafts",
  "draft_answers",
  "answer_citations",
  "research_findings",
  "review_reports",
  "review_findings",
  "revision_history",
  "usage_records",
  "export_records",
];

describe("Supabase security migration", () => {
  it.each(protectedTables)("enables RLS for %s", (table) => {
    expect(migration).toContain(
      `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`,
    );
  });

  it("keeps course material storage private and user-scoped", () => {
    expect(migration).toContain("'course-materials'");
    expect(migration).toContain("false,");
    expect(migration).toContain(
      "(storage.foldername(name))[1] = (SELECT auth.uid())::text",
    );
  });

  it("links application profiles to Supabase Auth users", () => {
    expect(migration).toContain("REFERENCES auth.users(id) ON DELETE CASCADE");
    expect(migration).toContain("CREATE TRIGGER on_auth_user_created");
  });
});
