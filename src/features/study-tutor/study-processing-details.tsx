"use client";

import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/lib/utils";
import {
  STUDY_PROCESSING_STEPS,
  type StudyDocumentProgress,
} from "./processing-progress";

const stageLabels: Record<StudyDocumentProgress["stage"], string> = {
  queued: "Waiting for the document worker",
  downloading: "Loading the stored file",
  extracting: "Extracting readable text",
  organizing: "Organizing study sections",
  indexing: "Building the search index",
  embedding: "Preparing semantic search",
  retrying: "Retry scheduled",
  ready: "Document processing complete",
  failed: "Document processing failed",
};

export function StudyProcessingDetails({
  progress,
  defaultExpanded = false,
}: {
  progress: StudyDocumentProgress;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const panelId = useId();
  const completed = new Set(progress.completedSteps);
  const completedCount = progress.completedSteps.length;
  const firstIncomplete = STUDY_PROCESSING_STEPS.find(
    (step) => !completed.has(step.id),
  )?.id;
  const counts = [
    progress.pageCount === undefined
      ? null
      : { label: "Pages/slides", value: progress.pageCount },
    progress.sectionCount === undefined
      ? null
      : { label: "Sections", value: progress.sectionCount },
    progress.chunkCount === undefined
      ? null
      : { label: "Search chunks", value: progress.chunkCount },
    progress.embeddedChunkCount === undefined
      ? null
      : {
          label: "Embeddings",
          value:
            progress.chunkCount === undefined
              ? progress.embeddedChunkCount
              : `${progress.embeddedChunkCount}/${progress.chunkCount}`,
        },
  ].filter((item) => item !== null);

  return (
    <div className="mt-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            "font-semibold",
            progress.stage === "failed"
              ? "text-rose-700"
              : progress.stage === "ready"
                ? "text-teal-700"
                : "text-sky-700",
          )}
        >
          {stageLabels[progress.stage]}
        </span>
        <span className="text-slate-500">
          {completedCount} of {STUDY_PROCESSING_STEPS.length} steps complete
        </span>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="mt-2 flex items-center gap-1 rounded-lg px-1 py-1 text-xs font-semibold text-teal-700 hover:text-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
      >
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
        {expanded ? "Hide processing details" : "Show processing details"}
      </button>
      {expanded && (
        <div id={panelId} className="mt-2 rounded-xl bg-slate-50/70 p-3">
          <ol className="space-y-2">
            {STUDY_PROCESSING_STEPS.map((step) => {
              const isComplete = completed.has(step.id);
              const isDeferred =
                step.id === "embedded" &&
                progress.embeddingStatus === "deferred";
              const isCurrent =
                step.id === firstIncomplete &&
                progress.stage !== "ready" &&
                progress.stage !== "failed";
              const isFailed =
                step.id === firstIncomplete && progress.stage === "failed";
              return (
                <li key={step.id} className="flex gap-2.5 text-xs">
                  {isComplete ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-600" />
                  ) : isDeferred ? (
                    <Clock3 className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  ) : isFailed ? (
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-600" />
                  ) : isCurrent ? (
                    <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-sky-600" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-slate-300" />
                  )}
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "font-medium",
                        isComplete
                          ? "text-slate-700"
                          : isDeferred
                            ? "text-amber-700"
                            : isFailed
                              ? "text-rose-700"
                              : isCurrent
                                ? "text-sky-700"
                                : "text-slate-400",
                      )}
                    >
                      {step.label}
                      {isDeferred ? " · deferred" : ""}
                    </span>
                    <span className="mt-0.5 block leading-5 text-slate-500">
                      {step.description}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          {counts.length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3 sm:grid-cols-4">
              {counts.map((item) => (
                <div key={item.label}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {item.label}
                  </dt>
                  <dd className="mt-0.5 text-xs font-semibold text-slate-700">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {progress.message && (
            <p
              className={cn(
                "mt-3 rounded-lg px-3 py-2 text-xs leading-5",
                progress.stage === "failed"
                  ? "bg-rose-50 text-rose-700"
                  : "bg-amber-50 text-amber-800",
              )}
            >
              {progress.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
