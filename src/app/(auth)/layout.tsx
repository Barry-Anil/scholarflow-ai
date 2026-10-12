import { Quote } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Wordmark } from "@/components/brand/wordmark";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[.9fr_1.1fr]">
      <section className="flex flex-col px-5 py-6 sm:px-10 lg:px-14">
        <Wordmark />
        <div className="mx-auto flex w-full max-w-md flex-1 items-center py-12">
          {children}
        </div>
        <p className="text-xs text-slate-400">
          By continuing, you remain responsible for reviewing and approving your
          academic work.
        </p>
      </section>
      <aside className="relative hidden overflow-hidden bg-slate-950 p-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-teal-500/15 blur-3xl" />
        <div className="relative">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-300">
            ScholarFlow method
          </p>
          <h2 className="mt-5 max-w-xl font-serif text-5xl leading-tight">
            Research, draft, review, revise—without losing the evidence trail.
          </h2>
        </div>
        <blockquote className="relative max-w-xl rounded-3xl border border-white/10 bg-white/5 p-7">
          <Quote className="mb-5 size-7 text-teal-300" />
          <p className="text-lg leading-8 text-slate-200">
            Course-specific evidence stays ahead of generic web knowledge, and
            every final decision stays with the student.
          </p>
          <Link
            href="/"
            className="mt-5 inline-block text-sm font-semibold text-teal-300 hover:text-teal-200"
          >
            Return to overview
          </Link>
        </blockquote>
      </aside>
    </main>
  );
}
