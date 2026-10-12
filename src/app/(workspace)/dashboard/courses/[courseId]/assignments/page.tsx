import { ArrowLeft, CalendarDays, ClipboardList, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateAssignmentForm } from "@/features/assignments/create-assignment-form";
import { getCourseAssignments } from "@/features/assignments/data";

type PageProps = { params: Promise<{ courseId: string }> };

export default function AssignmentsPage(props: PageProps) {
  return (
    <Suspense fallback={<AssignmentsLoadingState />}>
      <AssignmentsContent {...props} />
    </Suspense>
  );
}

async function AssignmentsContent({ params }: PageProps) {
  await connection();
  const { courseId } = await params;
  if (!z.uuid().safeParse(courseId).success) notFound();
  const data = await getCourseAssignments(courseId);
  if (!data) notFound();

  return (
    <main className="p-5 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href={`/dashboard/courses/${courseId}/knowledge`}>
              <ArrowLeft className="size-4" /> Course knowledge
            </Link>
          </Button>
          <p className="mt-4 text-sm font-semibold text-teal-700">
            {data.course.code || "Course workspace"}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
            {data.course.title} assignments
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Turn a brief and marking rubric into a structured, versioned writing
            workspace.
          </p>
        </div>

        {data.role !== "viewer" && (
          <Card>
            <CardHeader>
              <CardTitle>Create an assignment workspace</CardTitle>
              <CardDescription>
                The parser keeps your original brief and extracts a practical
                question and rubric outline. You remain in control of the draft.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateAssignmentForm courseId={courseId} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Existing assignments</CardTitle>
            <CardDescription>
              Open a workspace to continue from its most recent saved version.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.assignments.length ? (
              <div className="divide-y divide-slate-100">
                {data.assignments.map((assignment) => (
                  <Link
                    key={assignment.id}
                    href={`/dashboard/courses/${courseId}/assignments/${assignment.id}`}
                    className="group flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
                      <ClipboardList className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900 group-hover:text-teal-700">
                        {assignment.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <FileText className="size-3.5" />
                          {assignment.status.replaceAll("_", " ").toLowerCase()}
                        </span>
                        {assignment.dueAt && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="size-3.5" /> Due{" "}
                            {formatDate(assignment.dueAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-teal-700">
                      Open workspace →
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
                <ClipboardList className="mx-auto size-7 text-slate-300" />
                <p className="mt-3 font-medium text-slate-700">
                  No assignments yet
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Add the brief above to create your first writing workspace.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function AssignmentsLoadingState() {
  return (
    <main className="p-5 lg:p-8" aria-busy="true" aria-live="polite">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold text-teal-700">Assignments</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
          Loading assignment workspaces…
        </h1>
        <div className="mt-8 h-96 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
      </div>
    </main>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}
