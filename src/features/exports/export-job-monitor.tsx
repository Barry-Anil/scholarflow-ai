"use client";

import { FileDown, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function ExportJobMonitor({
  jobIds,
  workspacePath,
}: {
  jobIds: string[];
  workspacePath: string;
}) {
  const router = useRouter();
  const [completed, setCompleted] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        for (const [index, jobId] of jobIds.entries()) {
          let status = "processing";
          while (status === "processing") {
            const response = await fetch(`/api/export-jobs/${jobId}`, {
              method: "POST",
            });
            const body = (await response.json()) as {
              status?: string;
              message?: string;
            };
            if (!response.ok && response.status !== 202)
              throw new Error(
                body.message || "The export could not be processed.",
              );
            status = body.status ?? "failed";
            if (status === "processing")
              await new Promise((resolve) => window.setTimeout(resolve, 1_000));
            if (cancelled) return;
          }
          if (status !== "completed") throw new Error(bodyMessage(status));
          setCompleted(index + 1);
        }
        router.replace(
          `${workspacePath}?status=success&message=${encodeURIComponent("Export completed. A secure download is ready.")}`,
        );
        router.refresh();
      } catch (caught) {
        if (cancelled) return;
        const message =
          caught instanceof Error ? caught.message : "The export failed.";
        setError(message);
        router.replace(
          `${workspacePath}?status=error&message=${encodeURIComponent(message)}`,
        );
        router.refresh();
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [jobIds, router, workspacePath]);

  return (
    <div
      role={error ? "alert" : "status"}
      aria-live="polite"
      className={
        error
          ? "rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          : "flex items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800"
      }
    >
      {!error &&
        (completed < jobIds.length ? (
          <LoaderCircle className="size-4 shrink-0 animate-spin" />
        ) : (
          <FileDown className="size-4 shrink-0" />
        ))}
      <span>
        {error
          ? error
          : `Generating secure export ${Math.min(completed + 1, jobIds.length)} of ${jobIds.length}. Reopening this page safely resumes the job.`}
      </span>
    </div>
  );
}

function bodyMessage(status: string) {
  return status === "cancelled"
    ? "The export was cancelled."
    : "The export did not complete after the allowed retries.";
}
