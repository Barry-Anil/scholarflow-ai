"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type AgentJobMonitorProps = {
  jobIds: string[];
  workspacePath: string;
  operation: "research" | "draft" | "review" | "revision";
};

export function AgentJobMonitor({
  jobIds,
  workspacePath,
  operation,
}: AgentJobMonitorProps) {
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
            const response = await fetch(`/api/agent-jobs/${jobId}`, {
              method: "POST",
            });
            const body = (await response.json()) as {
              status?: string;
              message?: string;
            };
            if (!response.ok && response.status !== 202) {
              throw new Error(
                body.message || "The agent task could not be completed.",
              );
            }
            status = body.status ?? "failed";
            if (status === "processing") {
              await new Promise((resolve) => window.setTimeout(resolve, 750));
            }
            if (cancelled) return;
          }
          if (status !== "completed") {
            throw new Error("The agent task did not complete.");
          }
          setCompleted(index + 1);
        }

        const message =
          operation === "research"
            ? "Agent C completed research. Review the saved evidence."
            : operation === "draft"
              ? "Agent B saved a new evidence-backed draft version."
              : operation === "revision"
                ? "Agent B saved a revised draft. Inspect it before running Agent A again."
                : "Agent A completed its independent review. Inspect every remaining concern.";
        router.replace(
          `${workspacePath}?agent=${operation}&status=success&message=${encodeURIComponent(message)}`,
        );
        router.refresh();
      } catch (caught) {
        if (cancelled) return;
        const message =
          caught instanceof Error
            ? caught.message
            : "The agent task could not be completed.";
        setError(message);
        router.replace(
          `${workspacePath}?agent=${operation}&status=error&message=${encodeURIComponent(message)}`,
        );
        router.refresh();
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [jobIds, operation, router, workspacePath]);

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
      {!error && <LoaderCircle className="size-4 shrink-0 animate-spin" />}
      <span>
        {error
          ? error
          : `${agentLabel(operation)} is processing task ${Math.min(completed + 1, jobIds.length)} of ${jobIds.length}. You can safely resume by reopening this page.`}
      </span>
    </div>
  );
}

function agentLabel(operation: AgentJobMonitorProps["operation"]) {
  if (operation === "research") return "Agent C";
  if (operation === "draft") return "Agent B";
  if (operation === "revision") return "Agent B";
  return "Agent A";
}
