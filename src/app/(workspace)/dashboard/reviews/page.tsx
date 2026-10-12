import { ShieldCheck } from "lucide-react";
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
import { getReviewHub } from "@/features/workspace/data";
import {
  formatWorkspaceDate,
  humanizeStatus,
} from "@/features/workspace/format";

export default function ReviewHubPage() {
  return (
    <Suspense fallback={<ReviewLoading />}>
      <ReviewContent />
    </Suspense>
  );
}

async function ReviewContent() {
  await connection();
  const reports = await getReviewHub();

  return (
    <main className="p-5 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <WorkspacePageHeader
          eyebrow="Independent quality assurance"
          title="Review center"
          description="See Agent A review outcomes across assignments and return to unresolved findings that need your decision."
        />

        <Card>
          <CardHeader>
            <CardTitle>Review reports</CardTitle>
            <CardDescription>
              Review results support your inspection; they do not guarantee a
              perfect university submission.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {reports.length ? (
              <div className="divide-y divide-slate-100">
                {reports.map((report) => (
                  <Link
                    key={report.id}
                    href={`/dashboard/courses/${report.courseId}/assignments/${report.assignmentId}`}
                    className="group flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                  >
                    <span
                      className={`grid size-10 shrink-0 place-items-center rounded-xl ${
                        report.requiresAnotherCycle
                          ? "bg-amber-50 text-amber-700"
                          : "bg-teal-50 text-teal-700"
                      }`}
                    >
                      <ShieldCheck className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900 group-hover:text-teal-700">
                        {report.assignmentTitle}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {report.courseCode || report.courseTitle} �{" "}
                        {formatWorkspaceDate(report.createdAt)}
                        {report.estimatedScore === null
                          ? ""
                          : ` � Estimated ${Math.round(report.estimatedScore)}%`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {report.openFindings > 0 && (
                        <StatusPill tone="warning">
                          {report.openFindings} open finding
                          {report.openFindings === 1 ? "" : "s"}
                        </StatusPill>
                      )}
                      <StatusPill
                        tone={
                          report.requiresAnotherCycle ? "warning" : "success"
                        }
                      >
                        {humanizeStatus(report.overallStatus)}
                      </StatusPill>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <WorkspaceEmptyState
                icon={ShieldCheck}
                title="No review reports yet"
                description="Run Agent A from an assignment after a draft has been saved or generated."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function ReviewLoading() {
  return (
    <main className="p-5 lg:p-8" aria-busy="true">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold text-teal-700">Review center</p>
        <div className="mt-3 h-10 w-64 animate-pulse rounded-xl bg-slate-200" />
        <div className="mt-8 h-96 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
      </div>
    </main>
  );
}
