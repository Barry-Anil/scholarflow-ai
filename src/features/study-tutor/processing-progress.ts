export const STUDY_PROCESSING_STEPS = [
  {
    id: "stored",
    label: "Upload stored",
    description: "The original file is stored privately and queued.",
  },
  {
    id: "downloaded",
    label: "File loaded",
    description: "The worker loaded the stored file for processing.",
  },
  {
    id: "extracted",
    label: "Text extracted",
    description:
      "Readable document text and page or slide positions were extracted.",
  },
  {
    id: "organized",
    label: "Sections organized",
    description: "Headings and study sections were detected from the source.",
  },
  {
    id: "indexed",
    label: "Search index created",
    description: "The sections were split into searchable source chunks.",
  },
  {
    id: "embedded",
    label: "Semantic search prepared",
    description: "Embeddings were added for meaning-based retrieval.",
  },
] as const;

export type StudyProcessingStepId =
  (typeof STUDY_PROCESSING_STEPS)[number]["id"];

export type StudyProcessingStage =
  | "queued"
  | "downloading"
  | "extracting"
  | "organizing"
  | "indexing"
  | "embedding"
  | "retrying"
  | "ready"
  | "failed";

export type StudyDocumentProgress = {
  stage: StudyProcessingStage;
  completedSteps: StudyProcessingStepId[];
  updatedAt: string;
  pageCount?: number;
  sectionCount?: number;
  chunkCount?: number;
  embeddedChunkCount?: number;
  embeddingStatus?: "processing" | "complete" | "deferred";
  message?: string;
};

const stepIds = new Set<StudyProcessingStepId>(
  STUDY_PROCESSING_STEPS.map((step) => step.id),
);
const stages = new Set<StudyProcessingStage>([
  "queued",
  "downloading",
  "extracting",
  "organizing",
  "indexing",
  "embedding",
  "retrying",
  "ready",
  "failed",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

export function createStudyDocumentProgress(
  stage: StudyProcessingStage,
  completedSteps: StudyProcessingStepId[],
  details: Omit<
    Partial<StudyDocumentProgress>,
    "stage" | "completedSteps" | "updatedAt"
  > = {},
): StudyDocumentProgress {
  return {
    stage,
    completedSteps: [...new Set(completedSteps)],
    updatedAt: new Date().toISOString(),
    ...details,
  };
}

export function readStudyDocumentProgress(
  metadata: unknown,
  status: string,
): StudyDocumentProgress {
  const metadataRecord = record(metadata);
  const candidate = record(metadataRecord?.processing);
  if (candidate && stages.has(candidate.stage as StudyProcessingStage)) {
    const completedSteps = Array.isArray(candidate.completedSteps)
      ? candidate.completedSteps.filter(
          (step): step is StudyProcessingStepId =>
            typeof step === "string" &&
            stepIds.has(step as StudyProcessingStepId),
        )
      : [];
    const embeddingStatus = ["processing", "complete", "deferred"].includes(
      String(candidate.embeddingStatus),
    )
      ? (candidate.embeddingStatus as StudyDocumentProgress["embeddingStatus"])
      : undefined;
    return {
      stage: candidate.stage as StudyProcessingStage,
      completedSteps,
      updatedAt:
        typeof candidate.updatedAt === "string"
          ? candidate.updatedAt
          : new Date(0).toISOString(),
      pageCount: positiveInteger(candidate.pageCount),
      sectionCount: positiveInteger(candidate.sectionCount),
      chunkCount: positiveInteger(candidate.chunkCount),
      embeddedChunkCount: positiveInteger(candidate.embeddedChunkCount),
      embeddingStatus,
      message:
        typeof candidate.message === "string" ? candidate.message : undefined,
    };
  }

  const sectionCount = positiveInteger(metadataRecord?.sectionCount);
  const chunkCount = positiveInteger(metadataRecord?.chunkCount);
  const embeddedChunkCount = positiveInteger(
    metadataRecord?.embeddedChunkCount,
  );
  const completedSteps: StudyProcessingStepId[] = ["stored"];
  if (status === "ready") {
    completedSteps.push("downloaded", "extracted", "organized", "indexed");
    if (embeddedChunkCount && embeddedChunkCount === chunkCount)
      completedSteps.push("embedded");
  }
  return {
    stage:
      status === "failed" ? "failed" : status === "ready" ? "ready" : "queued",
    completedSteps,
    updatedAt: new Date(0).toISOString(),
    sectionCount,
    chunkCount,
    embeddedChunkCount,
    embeddingStatus:
      status === "ready"
        ? completedSteps.includes("embedded")
          ? "complete"
          : "deferred"
        : undefined,
  };
}
