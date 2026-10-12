import { FileText, Files, GraduationCap } from "lucide-react";
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
import { getKnowledgeHub } from "@/features/workspace/data";
import {
  formatFileSize,
  formatWorkspaceDate,
  humanizeStatus,
} from "@/features/workspace/format";

export default function KnowledgeHubPage() {
  return (
    <Suspense fallback={<KnowledgeLoading />}>
      <KnowledgeContent />
    </Suspense>
  );
}

async function KnowledgeContent() {
  await connection();
  const data = await getKnowledgeHub();

  return (
    <main className="p-5 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <WorkspacePageHeader
          eyebrow="Evidence library"
          title="Knowledge base"
          description="Browse source collections across courses, then open a course to upload, process, and search its material."
        />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.courses.map((course) => (
            <Link
              key={course.id}
              href={`/dashboard/courses/${course.id}/knowledge`}
              className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-teal-300"
            >
              <span className="grid size-10 place-items-center rounded-xl bg-teal-50 text-teal-700">
                <GraduationCap className="size-5" />
              </span>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-teal-700">
                {course.code || "Course"}
              </p>
              <h2 className="mt-1 font-semibold text-slate-950 group-hover:text-teal-700">
                {course.title}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {course.documentCount} searchable source
                {course.documentCount === 1 ? "" : "s"}
              </p>
            </Link>
          ))}
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Recent documents</CardTitle>
            <CardDescription>
              The latest source files from all of your courses.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.documents.length ? (
              <div className="divide-y divide-slate-100">
                {data.documents.map((document) => (
                  <Link
                    key={document.id}
                    href={`/dashboard/courses/${document.courseId}/knowledge`}
                    className="group flex items-center gap-4 py-4 first:pt-0 last:pb-0"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                      <FileText className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900 group-hover:text-teal-700">
                        {document.filename}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {document.courseCode || document.courseTitle} �{" "}
                        {formatFileSize(document.sizeBytes)} �{" "}
                        {formatWorkspaceDate(document.createdAt)}
                      </p>
                    </div>
                    <StatusPill
                      tone={
                        document.status === "ready"
                          ? "success"
                          : document.status === "failed"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {humanizeStatus(document.status)}
                    </StatusPill>
                  </Link>
                ))}
              </div>
            ) : (
              <WorkspaceEmptyState
                icon={Files}
                title="No source documents yet"
                description="Choose a course above to upload lecture notes, rubrics, PDFs, or DOCX files."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function KnowledgeLoading() {
  return (
    <main className="p-5 lg:p-8" aria-busy="true">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold text-teal-700">Knowledge base</p>
        <div className="mt-3 h-10 w-72 animate-pulse rounded-xl bg-slate-200" />
        <div className="mt-8 h-96 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
      </div>
    </main>
  );
}
