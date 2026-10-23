import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { StudyTutorHome } from "@/features/study-tutor/study-tutor-home";
import { getStudyTutorHomeData } from "@/features/study-tutor/data";

export const metadata: Metadata = { title: "Study Tutor" };

export default function StudyTutorPage() {
  return (
    <Suspense fallback={<StudyTutorLoading />}>
      <StudyTutorContent />
    </Suspense>
  );
}

async function StudyTutorContent() {
  await connection();
  const data = await getStudyTutorHomeData();
  return <StudyTutorHome sessions={data.sessions} />;
}

function StudyTutorLoading() {
  return (
    <main className="p-5 lg:p-8" aria-busy="true" aria-live="polite">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm font-semibold text-teal-700">Study Tutor</p>
        <div className="mt-3 h-10 w-64 animate-pulse rounded-xl bg-slate-200" />
        <div className="mt-8 h-96 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm" />
      </div>
    </main>
  );
}
