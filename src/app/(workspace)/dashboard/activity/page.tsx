import { Activity, Bot } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  StatusPill,
  WorkspaceEmptyState,
  WorkspacePageHeader,
} from "@/components/workspace/hub-ui";
import { AgentActivityTracker } from "@/features/agents/agent-activity-tracker";
import {
  activityAgents,
  type ActivityRun,
} from "@/features/agents/activity-model";
import { getActivityHub } from "@/features/workspace/data";
import {
  formatWorkspaceDate,
  humanizeStatus,
} from "@/features/workspace/format";

export default function ActivityHubPage() {
  return (
    <Suspense fallback={<ActivityLoading />}>
      <ActivityContent />
    </Suspense>
  );
}

async function ActivityContent() {
  await connection();
  const runs = await getActivityHub();
  const serializedRuns: ActivityRun[] = runs.map((run) => ({
    ...run,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
  }));

  return (
    <main className="p-5 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <WorkspacePageHeader
          eyebrow="Workflow history"
          title="Agent activity"
          description="Track recent research, drafting, reviewing, and revision runs across every assignment."
        />

        <AgentActivityTracker initialRuns={serializedRuns} />

        <Card>
          <CardHeader>
            <CardTitle>Recent agent runs</CardTitle>
            <CardDescription>
              Open the related assignment to inspect evidence, output, and
              detailed event history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {runs.length ? (
              <div className="divide-y divide-slate-100">
                {runs.map((run) => (
                  <Link
                    key={run.id}
                    href={`/dashboard/courses/${run.courseId}/assignments/${run.assignmentId}`}
                    className="group flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700">
                      <Bot className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold capitalize text-slate-900 group-hover:text-teal-700">
                        {activityAgents.find(
                          (profile) => profile.agent === run.agent,
                        )?.label ?? "System agent"}
                      </p>
                      <p className="mt-1 truncate text-sm text-slate-600">
                        {run.assignmentTitle}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {run.courseCode || run.courseTitle} ·{" "}
                        {formatWorkspaceDate(run.createdAt)}
                        {run.model ? ` · ${run.model}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone="info">
                        {humanizeStatus(run.workflowState)}
                      </StatusPill>
                      <StatusPill
                        tone={
                          run.status === "completed"
                            ? "success"
                            : run.status === "failed"
                              ? "danger"
                              : run.status === "cancelled"
                                ? "neutral"
                                : "warning"
                        }
                      >
                        {humanizeStatus(run.status)}
                      </StatusPill>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <WorkspaceEmptyState
                icon={Activity}
                title="No agent activity yet"
                description="Run research or drafting from an assignment workspace and its history will appear here."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function ActivityLoading() {
  return (
    <main className="p-5 lg:p-8" aria-busy="true">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold text-teal-700">Agent activity</p>
        <div className="mt-3 h-10 w-64 animate-pulse rounded-xl bg-slate-200" />
        <div className="mt-8 h-96 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
      </div>
    </main>
  );
}
