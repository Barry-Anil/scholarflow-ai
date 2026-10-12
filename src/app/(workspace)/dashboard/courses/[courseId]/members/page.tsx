import { ArrowLeft, ShieldCheck, Trash2, Users } from "lucide-react";
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
import {
  changeCourseMemberRoleAction,
  removeCourseMemberAction,
} from "@/features/courses/member-actions";
import { AddCourseMemberForm } from "@/features/courses/member-manager";
import { getCourseMembers } from "@/features/courses/members";
import { formatWorkspaceDate } from "@/features/workspace/format";

type PageProps = { params: Promise<{ courseId: string }> };

export default function CourseMembersPage(props: PageProps) {
  return (
    <Suspense fallback={<MembersLoading />}>
      <MembersContent {...props} />
    </Suspense>
  );
}

async function MembersContent({ params }: PageProps) {
  await connection();
  const { courseId } = await params;
  if (!z.uuid().safeParse(courseId).success) notFound();
  const data = await getCourseMembers(courseId);
  if (!data) notFound();
  const canManage = data.role === "owner";

  return (
    <main className="p-5 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href="/dashboard/courses">
              <ArrowLeft className="size-4" /> All courses
            </Link>
          </Button>
          <p className="mt-4 text-sm font-semibold text-teal-700">
            {data.course.code || "Course workspace"}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
            {data.course.title} members
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Owners manage access, editors run academic workflows, and viewers
            inspect course evidence and results without changing them.
          </p>
        </div>

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle>Add or update a member</CardTitle>
              <CardDescription>
                The person must already have a registered ScholarFlow account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AddCourseMemberForm courseId={courseId} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Course access</CardTitle>
            <CardDescription>
              {data.members.length} member
              {data.members.length === 1 ? "" : "s"} can access this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-100">
              {data.members.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                    {member.role === "owner" ? (
                      <ShieldCheck className="size-5" />
                    ) : (
                      <Users className="size-5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">
                      {member.displayName || member.email}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {member.email} · Added{" "}
                      {formatWorkspaceDate(member.createdAt)}
                    </p>
                  </div>
                  {canManage && member.role !== "owner" ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <form
                        action={changeCourseMemberRoleAction.bind(
                          null,
                          courseId,
                          member.id,
                        )}
                        className="flex items-center gap-2"
                      >
                        <select
                          name="role"
                          defaultValue={member.role}
                          aria-label={`Role for ${member.email}`}
                          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                        </select>
                        <Button type="submit" size="sm" variant="secondary">
                          Save
                        </Button>
                      </form>
                      <form
                        action={removeCourseMemberAction.bind(
                          null,
                          courseId,
                          member.id,
                        )}
                      >
                        <Button
                          type="submit"
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${member.email}`}
                        >
                          <Trash2 className="size-4 text-rose-600" />
                        </Button>
                      </form>
                    </div>
                  ) : (
                    <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold capitalize text-teal-700">
                      {member.role}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function MembersLoading() {
  return (
    <main className="p-5 lg:p-8" aria-busy="true">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold text-teal-700">Course members</p>
        <div className="mt-3 h-10 w-64 animate-pulse rounded-xl bg-slate-200" />
        <div className="mt-8 h-80 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
      </div>
    </main>
  );
}
