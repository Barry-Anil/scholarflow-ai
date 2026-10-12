import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";

import {
  AI_USE_DISCLOSURE,
  numberedReferences,
  plainMarkdownBlocks,
  reviewStatusLabel,
  type AssignmentExportModel,
} from "./content";
import { citationIdentity, citationLocator } from "./citation-format";

export async function createDocxExport(model: AssignmentExportModel) {
  const { references, numberByIdentity } = numberedReferences(model);
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun(model.assignmentTitle)],
      spacing: { after: 240 },
    }),
    detailParagraph("Course", model.courseLabel),
    detailParagraph("Approved draft", `Version ${model.draftVersion}`),
    detailParagraph("Approved at", model.approvedAt.toISOString()),
    detailParagraph("Review status", reviewStatusLabel(model.reviewStatus)),
  ];

  for (const answer of model.answers) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        text: `Question ${answer.position + 1}`,
      }),
      new Paragraph({
        children: [new TextRun({ text: answer.prompt, italics: true })],
        spacing: { after: 180 },
      }),
    );
    for (const block of plainMarkdownBlocks(answer.markdown)) {
      children.push(
        new Paragraph({
          text: block,
          spacing: { after: 150, line: 300 },
        }),
      );
    }
    if (answer.citations.length) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          text: "Evidence citations",
        }),
      );
      for (const citation of answer.citations) {
        const number = numberByIdentity.get(citationIdentity(citation));
        const locator = citationLocator(citation);
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            text: `[${number}] ${citation.claimText}${locator ? ` - ${locator}` : ""} - ${citation.verified ? "Verified" : "Unverified"}`,
            spacing: { after: 100 },
          }),
        );
      }
    }
  }

  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, text: "References" }),
  );
  references.forEach((reference) =>
    children.push(
      new Paragraph({
        indent: { left: 360, hanging: 360 },
        text: `[${reference.number}] ${reference.text}`,
        spacing: { after: 120, line: 280 },
      }),
    ),
  );
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      text: "Review and approval",
    }),
    new Paragraph({
      text: `Agent A status: ${reviewStatusLabel(model.reviewStatus)}. Student approval applies only to draft version ${model.draftVersion}.`,
      spacing: { after: 160 },
    }),
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      text: "AI use disclosure",
    }),
    new Paragraph({ text: AI_USE_DISCLOSURE, spacing: { line: 300 } }),
  );

  const document = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: 22, color: "000000" },
          paragraph: { spacing: { after: 140, line: 300 } },
        },
        title: {
          run: { font: "Arial", size: 34, bold: true, color: "000000" },
        },
        heading1: {
          run: { font: "Arial", size: 28, bold: true, color: "000000" },
          paragraph: { spacing: { before: 280, after: 140 } },
        },
        heading2: {
          run: { font: "Arial", size: 24, bold: true, color: "000000" },
          paragraph: { spacing: { before: 220, after: 100 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1080, right: 1080, bottom: 1440, left: 1080 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun("Page "),
                  new TextRun({ children: [PageNumber.CURRENT] }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(document);
}

function detailParagraph(label: string, value: string) {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun(value),
    ],
    spacing: { after: 80 },
  });
}
