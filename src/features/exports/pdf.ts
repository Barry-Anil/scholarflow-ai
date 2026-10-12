import PDFDocument from "pdfkit";

import {
  AI_USE_DISCLOSURE,
  numberedReferences,
  plainMarkdownBlocks,
  reviewStatusLabel,
  type AssignmentExportModel,
} from "./content";
import { citationIdentity, citationLocator } from "./citation-format";

export async function createPdfExport(model: AssignmentExportModel) {
  const document = new PDFDocument({
    size: "LETTER",
    margins: { top: 64, right: 64, bottom: 64, left: 64 },
    bufferPages: true,
    info: { Title: model.assignmentTitle, Author: "ScholarFlow AI" },
  });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  const { references, numberByIdentity } = numberedReferences(model);

  document
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor("#000000")
    .text(model.assignmentTitle, { align: "center" })
    .moveDown(1);
  detail(document, "Course", model.courseLabel);
  detail(document, "Approved draft", `Version ${model.draftVersion}`);
  detail(document, "Approved at", model.approvedAt.toISOString());
  detail(document, "Review status", reviewStatusLabel(model.reviewStatus));

  for (const answer of model.answers) {
    if (answer.position > 0 && document.y > 180) document.addPage();
    heading(document, `Question ${answer.position + 1}`, 16);
    document
      .font("Helvetica-Oblique")
      .fontSize(10.5)
      .fillColor("#333333")
      .text(answer.prompt, { lineGap: 3 })
      .moveDown(0.8);
    for (const block of plainMarkdownBlocks(answer.markdown)) {
      document
        .font("Helvetica")
        .fontSize(10.5)
        .fillColor("#111111")
        .text(block, { lineGap: 3 })
        .moveDown(0.6);
    }
    if (answer.citations.length) {
      heading(document, "Evidence citations", 12);
      for (const citation of answer.citations) {
        const number = numberByIdentity.get(citationIdentity(citation));
        const locator = citationLocator(citation);
        document
          .font("Helvetica")
          .fontSize(9.5)
          .text(
            `- [${number}] ${citation.claimText}${locator ? ` - ${locator}` : ""} - ${citation.verified ? "Verified" : "Unverified"}`,
            { indent: 12, lineGap: 2 },
          )
          .moveDown(0.4);
      }
    }
  }

  document.addPage();
  heading(document, "References", 16);
  references.forEach((reference) => {
    document
      .font("Helvetica")
      .fontSize(9.5)
      .text(`[${reference.number}] ${reference.text}`, {
        indent: 12,
        paragraphGap: 6,
        lineGap: 2,
      });
  });
  heading(document, "Review and approval", 16);
  document
    .font("Helvetica")
    .fontSize(10.5)
    .text(
      `Agent A status: ${reviewStatusLabel(model.reviewStatus)}. Student approval applies only to draft version ${model.draftVersion}.`,
      { lineGap: 3 },
    );
  heading(document, "AI use disclosure", 16);
  document
    .font("Helvetica")
    .fontSize(10.5)
    .text(AI_USE_DISCLOSURE, { lineGap: 3 });

  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    const bottomMargin = document.page.margins.bottom;
    document.page.margins.bottom = 0;
    document
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#666666")
      .text(
        `Page ${index + 1} of ${range.count}`,
        64,
        document.page.height - 36,
        {
          width: 484,
          align: "center",
          lineBreak: false,
        },
      );
    document.page.margins.bottom = bottomMargin;
  }
  document.end();
  return completed;
}

function detail(document: PDFKit.PDFDocument, label: string, value: string) {
  document
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#000000")
    .text(`${label}: `, { continued: true })
    .font("Helvetica")
    .text(value)
    .moveDown(0.25);
}

function heading(document: PDFKit.PDFDocument, text: string, size: number) {
  document
    .moveDown(1)
    .font("Helvetica-Bold")
    .fontSize(size)
    .fillColor("#000000")
    .text(text)
    .moveDown(0.5);
}
