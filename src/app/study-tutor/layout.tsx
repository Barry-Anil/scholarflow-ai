import { LogOut } from "lucide-react";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { WorkspaceNav } from "@/components/workspace/workspace-nav";
import { signOutAction } from "@/features/auth/actions";
import { requireUser } from "@/lib/auth/session";

export const instant = false;

export default async function StudyTutorLayout({
  children,
}: {
  children: ReactNode;
}) {
  await connection();
  const user = await requireUser();
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden border-r border-slate-200 bg-white p-5 lg:flex lg:flex-col">
        <Wordmark className="px-2" />
        <WorkspaceNav />
        <div className="mt-auto rounded-2xl bg-teal-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
            Study Tutor
          </p>
          <p className="mt-2 text-sm leading-5 text-teal-900">
            Learn from your own notes with traceable explanations and questions.
          </p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-18 items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-8">
          <Wordmark href="/dashboard" className="lg:hidden" />
          <div className="hidden lg:block">
            <p className="text-xs font-medium text-slate-400">Signed in as</p>
            <p className="text-sm font-semibold text-slate-700">{user.email}</p>
          </div>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm">
              <LogOut className="size-4" />
              Sign out
            </Button>
          </form>
        </header>
        <div className="border-b border-slate-200 bg-white lg:hidden">
          <WorkspaceNav mobile />
        </div>
        {children}
      </div>
    </div>
  );
}
