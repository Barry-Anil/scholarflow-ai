"use client";

import { useEffect, useState } from "react";

import { AgentActivityTransfer } from "@/components/kokonutui/currency-transfer";
import { humanizeStatus } from "@/features/workspace/format";
import {
  activityAgents,
  activityCompletedSteps,
  activityTransferStatus,
  hasActiveRuns,
  latestRunForAgent,
  type ActivityRun,
} from "./activity-model";

const POLL_MS = 5_000;

export function AgentActivityTracker({
  initialRuns,
}: {
  initialRuns: ActivityRun[];
}) {
  const [runs, setRuns] = useState(initialRuns);
  const active = hasActiveRuns(runs);

  useEffect(() => {
    if (!active) return;
    let fetching = false;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      if (fetching) return;
      fetching = true;
      try {
        const response = await fetch("/api/agent-activity", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as { runs?: ActivityRun[] };
        if (body.runs) setRuns(body.runs);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // A later poll can recover from a transient network failure.
        }
      } finally {
        fetching = false;
      }
    }, POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [active]);

  return (
    <section aria-labelledby="agent-tracker-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="agent-tracker-title"
            className="text-lg font-semibold text-slate-950"
          >
            Bot activity tracker
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Latest run for each agent. Active runs refresh every five seconds.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {active ? "Live updates on" : "All agents settled"}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {activityAgents.map((profile) => {
          const run = latestRunForAgent(runs, profile.agent);
          const created = run ? formatDate(run.createdAt) : "No run queued";
          const started = run?.startedAt
            ? formatDate(run.startedAt)
            : run?.status === "queued"
              ? "Waiting for a worker"
              : "Not started";
          const completed = run?.completedAt
            ? formatDate(run.completedAt)
            : run?.status === "failed" || run?.status === "cancelled"
              ? "No output saved"
              : "Waiting for output";
          return (
            <AgentActivityTransfer
              key={profile.agent}
              agentLabel={profile.label}
              role={profile.role}
              assignment={run?.assignmentTitle ?? "No activity recorded yet"}
              workflow={run ? humanizeStatus(run.workflowState) : "Idle"}
              runStatus={run ? humanizeStatus(run.status) : "Ready"}
              status={activityTransferStatus(run?.status)}
              completedSteps={activityCompletedSteps(run)}
              runId={run?.id}
              timestamp={run ? formatDate(run.createdAt) : "Ready for work"}
              href={
                run
                  ? `/dashboard/courses/${run.courseId}/assignments/${run.assignmentId}`
                  : undefined
              }
              steps={[
                { id: "queued", title: "Run queued", detail: created },
                { id: "started", title: "Agent started", detail: started },
                {
                  id: "model",
                  title: "Model processing",
                  detail: run?.model ?? "No model selected yet",
                },
                { id: "saved", title: "Output saved", detail: completed },
              ]}
            />
          );
        })}
      </div>
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
