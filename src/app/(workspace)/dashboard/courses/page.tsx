import { BookOpen, Files, GraduationCap, Users } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  WorkspaceEmptyState,
  WorkspacePageHeader,
} from "@/components/workspace/hub-ui";
import { NewCourseForm } from "@/features/courses/new-course-form";
import { getCoursesHub } from "@/features/workspace/data";

export default function CoursesHubPage() {
  return (
    <Suspense fallback={<CoursesLoading />}>
      <CoursesContent />
    </Suspense>
  );
}

async function CoursesContent() {
  await connection();
  const courses = await getCoursesHub();

  return (
    <main className="p-5 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <WorkspacePageHeader
          eyebrow="Course workspaces"
          title="Courses"
          description="Organize course evidence and assignment workspaces in one place."
        />

        <Card>
          <CardHeader>
            <CardTitle>Create a course</CardTitle>
            <CardDescription>
              Each course keeps its source material and assignments separated.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewCourseForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>All courses</CardTitle>
            <CardDescription>
              Open the knowledge base or assignment list for any course.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {courses.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {courses.map((course) => (
                  <article
                    key={course.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5"
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700">
                        <GraduationCap className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                          {course.code || "Course"}
                        </p>
                        <h2 className="mt-1 truncate font-semibold text-slate-950">
                          {course.title}
                        </h2>
                        {course.description && (
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">
                            {course.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 flex gap-4 text-xs text-slate-500">
                      <span>{course.documentCount} documents</span>
                      <span>{course.assignmentCount} assignments</span>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="secondary">
                        <Link
                          href={`/dashboard/courses/${course.id}/knowledge`}
                        >
                          <Files className="size-4" /> Knowledge
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          href={`/dashboard/courses/${course.id}/assignments`}
                        >
                          <BookOpen className="size-4" /> Assignments
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/dashboard/courses/${course.id}/members`}>
                          <Users className="size-4" /> Members
                        </Link>
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <WorkspaceEmptyState
                icon={BookOpen}
                title="No courses yet"
                description="Create your first course above to begin organizing evidence."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function CoursesLoading() {
  return <HubLoading label="Courses" />;
}

function HubLoading({ label }: { label: string }) {
  return (
    <main className="p-5 lg:p-8" aria-busy="true">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold text-teal-700">{label}</p>
        <div className="mt-3 h-10 w-56 animate-pulse rounded-xl bg-slate-200" />
        <div className="mt-8 h-96 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
      </div>
    </main>
  );
}
