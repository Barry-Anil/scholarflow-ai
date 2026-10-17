import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { acceptedDocumentTypes } from "@/features/knowledge/constants";

const migration = readFileSync(
  resolve("drizzle/0006_course_material_code_mimes.sql"),
  "utf8",
);

describe("course material storage MIME migration", () => {
  it("allows every MIME type accepted by document validation", () => {
    expect(migration).toContain("WHERE id = 'course-materials'");

    for (const mimeType of Object.keys(acceptedDocumentTypes)) {
      expect(migration).toContain(`'${mimeType}'`);
    }
  });
});
