import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("drizzle/0003_complex_plazm.sql"),
  "utf8",
);

describe("approval and export security migration", () => {
  it("stores immutable draft approval evidence with owner-scoped RLS", () => {
    expect(migration).toContain('CREATE TABLE "draft_approvals"');
    expect(migration).toContain(
      "ALTER TABLE public.draft_approvals ENABLE ROW LEVEL SECURITY",
    );
    expect(migration).toContain("draft_approvals_own_read");
    expect(migration).toContain("draft_approvals_own_insert");
  });

  it("creates a private owner-scoped assignment export bucket", () => {
    expect(migration).toContain("'assignment-exports'");
    expect(migration).toContain("assignment_exports_owner_read");
    expect(migration).toContain("assignment_exports_owner_insert");
    expect(migration).toContain(
      "(storage.foldername(name))[1] = (SELECT auth.uid())::text",
    );
  });

  it("binds every new export record to an approval", () => {
    expect(migration).toContain(
      'ALTER TABLE "export_records" ADD COLUMN "approval_id" uuid NOT NULL',
    );
    expect(migration).toContain(
      "export_records_approval_id_draft_approvals_id_fk",
    );
  });
});
