import { strToU8, zipSync } from "fflate";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { validateStudyFileSignature } from "@/features/study-tutor/extract";
import { extractPptxText } from "@/features/study-tutor/pptx";
import { detectStudySections } from "@/features/study-tutor/sections";
import { synthesizeInworldSpeech } from "@/lib/tts/inworld";

describe("Study Tutor ingestion", () => {
  it("rejects a file whose contents do not match its PDF type", () => {
    expect(() =>
      validateStudyFileSignature(strToU8("plain text"), "application/pdf"),
    ).toThrow(/do not match a PDF/i);
  });

  it("preserves PowerPoint slide numbers and visible text", () => {
    const archive = zipSync({
      "ppt/slides/slide2.xml": strToU8(
        '<p:sld xmlns:a="a"><a:t>Second &amp; final</a:t></p:sld>',
      ),
      "ppt/slides/slide1.xml": strToU8(
        '<p:sld xmlns:a="a"><a:t>First slide</a:t><a:t>Key idea</a:t></p:sld>',
      ),
    });
    const result = extractPptxText(
      archive.buffer.slice(
        archive.byteOffset,
        archive.byteOffset + archive.byteLength,
      ) as ArrayBuffer,
    );
    expect(result.pages).toEqual([
      { pageNumber: 1, text: "First slide\nKey idea" },
      { pageNumber: 2, text: "Second & final" },
    ]);
  });

  it("uses real headings and page locators when creating sections", () => {
    const sections = detectStudySections(
      [
        {
          pageNumber: 7,
          text: "CHAPTER 1\nCore concept and supporting detail.\n1.1 Example\nA worked example.",
        },
      ],
      "Notes",
    );
    expect(sections.map((section) => section.title)).toEqual([
      "CHAPTER 1",
      "1.1 Example",
    ]);
    expect(sections.every((section) => section.pageStart === 7)).toBe(true);
  });
});

describe("Inworld TTS", () => {
  it("constructs an authenticated MP3 request and decodes the audio", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          audioContent: Buffer.from("audio").toString("base64"),
          usage: { processedCharactersCount: 11, modelId: "inworld-tts-2" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = await synthesizeInworldSpeech(
      {
        apiKey: "encoded-credential",
        modelId: "inworld-tts-2",
        defaultVoiceId: "Ashley",
        timeoutMs: 5_000,
      },
      { text: "Hello notes" },
      fetcher,
    );
    expect(result.audio.toString()).toBe("audio");
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.inworld.ai/tts/v1/voice");
    expect(new Headers(request?.headers).get("Authorization")).toBe(
      "Basic encoded-credential",
    );
    expect(JSON.parse(String(request?.body))).toMatchObject({
      text: "Hello notes",
      voiceId: "Ashley",
      modelId: "inworld-tts-2",
      audioConfig: { audioEncoding: "MP3" },
    });
  });
});

describe("Study Tutor production workflow", () => {
  const uploadRoute = readFileSync(
    resolve("src/app/api/study-tutor/upload/route.ts"),
    "utf8",
  );
  const progressRoute = readFileSync(
    resolve("src/app/api/study-tutor/progress/route.ts"),
    "utf8",
  );
  const worker = readFileSync(resolve("scripts/agent-worker.ts"), "utf8");
  const workspace = readFileSync(
    resolve("src/features/study-tutor/study-workspace.tsx"),
    "utf8",
  );

  it("queues extraction instead of processing a large document in the request", () => {
    expect(uploadRoute).toContain("STUDY_DOCUMENT_JOB_TYPE");
    expect(uploadRoute).toContain("processingJobs");
    expect(uploadRoute).not.toContain("await processStudyDocument");
    expect(worker).toContain("processClaimedStudyDocumentJob");
  });

  it("preserves completion when recording a view", () => {
    expect(progressRoute).toContain('parsed.data.action === "view"');
    expect(progressRoute).toContain("? { lastViewedAt: new Date() }");
  });

  it("keeps generated lessons available across section and mode switches", () => {
    expect(workspace).toContain("generatedLessons");
    expect(workspace).toContain("setGeneratedLessons");
  });
});
