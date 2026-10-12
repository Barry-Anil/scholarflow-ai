import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Clock3,
  FileCheck2,
  GraduationCap,
} from "lucide-react";
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
import { NewCourseForm } from "@/features/courses/new-course-form";
import { getWorkspaceOverview } from "@/features/dashboard/data";

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardLoadingState />}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  await connection();
  const { user, metrics, recentCourses } = await getWorkspaceOverview();
  const firstName = user.displayName?.split(" ")[0] ?? "there";
  const cards = [
    {
      label: "Active courses",
      value: metrics.courses,
      icon: BookOpen,
      tone: "bg-sky-50 text-sky-700",
    },
    {
      label: "Assignments in progress",
      value: metrics.activeAssignments,
      icon: Clock3,
      tone: "bg-amber-50 text-amber-700",
    },
    {
      label: "Awaiting your approval",
      value: metrics.awaitingApproval,
      icon: FileCheck2,
      tone: "bg-teal-50 text-teal-700",
    },
    {
      label: "Failed jobs",
      value: metrics.failedJobs,
      icon: AlertTriangle,
      tone: metrics.failedJobs
        ? "bg-rose-50 text-rose-700"
        : "bg-slate-100 text-slate-500",
    },
  ];

  return (
    <main className="p-5 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold text-teal-700">
              Workspace overview
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
              Good to see you, {firstName}.
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Your metrics below are read directly from the workspace database.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">
            Evidence-first workspace ready
          </div>
        </div>

        <section
          className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="Workspace metrics"
        >
          {cards.map(({ label, value, icon: Icon, tone }) => (
            <Card key={label}>
              <CardContent className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-500">{label}</p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                    {value}
                  </p>
                </div>
                <span
                  className={`grid size-10 place-items-center rounded-xl ${tone}`}
                >
                  <Icon className="size-5" />
                </span>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Create your first course</CardTitle>
              <CardDescription>
                Courses contain assignments, study material, rubrics, and
                authorized members.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <NewCourseForm />
            </CardContent>
          </Card>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_.8fr]">
          <Card>
            <CardHeader>
              <CardTitle>Recent courses</CardTitle>
              <CardDescription>
                Your most recently created course workspaces.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentCourses.length ? (
                <div className="divide-y divide-slate-100">
                  {recentCourses.map((course) => (
                    <Link
                      key={course.id}
                      href={`/dashboard/courses/${course.id}/knowledge`}
                      className="flex items-center gap-4 py-4 first:pt-0 last:pb-0"
                    >
                      <span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-600">
                        <GraduationCap className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-900">
                          {course.title}
                        </p>
                        <p className="text-sm text-slate-500">
                          {course.code || "No course code"}
                        </p>
                      </div>
                      <ArrowUpRight className="size-4 text-slate-300" />
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
                  <BookOpen className="mx-auto size-7 text-slate-300" />
                  <p className="mt-3 font-medium text-slate-700">
                    No courses yet
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Use the form above to establish your first knowledge
                    workspace.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>System readiness</CardTitle>
              <CardDescription>
                Core services supporting your private assignment workflow.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                "Authenticated Supabase session",
                "PostgreSQL persistence",
                "Private-by-default data model",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-xl bg-teal-50 px-4 py-3 text-sm font-medium text-teal-900"
                >
                  <FileCheck2 className="size-4 text-teal-600" />
                  {item}
                </div>
              ))}
              <div className="flex items-center gap-3 rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-600">
                <FileCheck2 className="size-4 text-teal-600" />
                Document processing and retrieval
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

function DashboardLoadingState() {
  return (
    <main className="p-5 lg:p-8" aria-busy="true" aria-live="polite">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm font-semibold text-teal-700">
          Workspace overview
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
          Loading your workspace…
        </h1>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
