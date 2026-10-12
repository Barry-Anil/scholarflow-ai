import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createDocxExport } from "../src/features/exports/docx";
import { createPdfExport } from "../src/features/exports/pdf";
import type { AssignmentExportModel } from "../src/features/exports/content";

const format = process.argv[2];
if (format !== "docx" && format !== "pdf") throw new Error("Pass docx or pdf.");

const repeatedAnalysis = Array.from(
  { length: 8 },
  (_, index) =>
    `Paragraph ${index + 1}. The evidence supports a qualified conclusion when its scope, limitations, and competing explanations are considered. This sample verifies paragraph wrapping, page transitions, readable typography, and spacing in a realistic academic export.`,
).join("\n\n");

const model: AssignmentExportModel = {
  assignmentTitle: "Evidence Based Assignment Export",
  courseLabel: "SOC101 Social Inquiry",
  draftVersion: 4,
  approvedAt: new Date("2026-10-10T10:00:00.000Z"),
  reviewStatus: "quality_gates_passed",
  answers: [
    {
      position: 0,
      prompt:
        "Evaluate the evidence and explain how its limitations affect the conclusion.",
      markdown: repeatedAnalysis,
      citations: [
        {
          sourceType: "course_material",
          sourceId: "course-source-1",
          claimText: "The course material defines the analytical framework.",
          locator: "Pages 7-8",
          metadata: { title: "Week 3 lecture notes.pdf" },
          verified: true,
        },
        {
          sourceType: "external",
          sourceId: "doi:10.1000/example",
          claimText: "The study reports the observed relationship.",
          locator: null,
          metadata: {
            title: "A careful study",
            authors: ["Alex Smith", "Priya Rao"],
            year: 2025,
            containerTitle: "Journal of Examples",
            doi: "10.1000/example",
          },
          verified: true,
        },
      ],
    },
    {
      position: 1,
      prompt: "Compare the strongest competing explanation.",
      markdown: repeatedAnalysis,
      citations: [
        {
          sourceType: "course_material",
          sourceId: "course-source-1",
          claimText: "The course material identifies a competing explanation.",
          locator: "Page 9",
          metadata: { title: "Week 3 lecture notes.pdf" },
          verified: true,
        },
      ],
    },
  ],
};

async function main() {
  const outputDirectory = resolve("tmp/export-qa");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = resolve(outputDirectory, `assignment-export.${format}`);
  const buffer =
    format === "docx"
      ? await createDocxExport(model)
      : await createPdfExport(model);
  await writeFile(outputPath, buffer);
  console.log(outputPath);
}

void main();
