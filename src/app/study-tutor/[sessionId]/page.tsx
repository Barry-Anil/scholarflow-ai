import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { StudyWorkspace } from "@/features/study-tutor/study-workspace";
import { getStudySessionData } from "@/features/study-tutor/data";

export const metadata: Metadata = { title: "Study session" };

export default function StudySessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  return (
    <Suspense fallback={<StudySessionLoading />}>
      <StudySessionContent params={params} />
    </Suspense>
  );
}

async function StudySessionContent({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  await connection();
  const { sessionId } = await params;
  const data = await getStudySessionData(sessionId);
  if (!data) notFound();
  return <StudyWorkspace data={data} />;
}

function StudySessionLoading() {
  return (
    <main className="p-5 lg:p-8" aria-busy="true" aria-live="polite">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm font-semibold text-teal-700">Study session</p>
        <div className="mt-3 h-10 w-72 animate-pulse rounded-xl bg-slate-200" />
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="h-[34rem] animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
          <div className="h-80 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
        </div>
      </div>
    </main>
  );
}
