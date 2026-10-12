import {
  ArrowRight,
  CheckCircle2,
  Database,
  FileSearch,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { getConfigurationStatus } from "@/lib/env/server";

const agents = [
  {
    label: "Agent B",
    name: "Student Agent",
    copy: "Plans, drafts, cites, and revises each assignment answer.",
    tone: "bg-teal-50 text-teal-700",
  },
  {
    label: "Agent C",
    name: "Research Team",
    copy: "Finds course evidence first and reports gaps or conflicts.",
    tone: "bg-sky-50 text-sky-700",
  },
  {
    label: "Agent A",
    name: "Independent Reviewer",
    copy: "Tests the draft against the original brief and rubric.",
    tone: "bg-amber-50 text-amber-700",
  },
];

export default function Home() {
  const configured = getConfigurationStatus().ready;
  return (
    <div className="min-h-screen bg-canvas text-slate-950">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 lg:px-8">
        <Wordmark />
        <nav
          className="flex items-center gap-2"
          aria-label="Primary navigation"
        >
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href={configured ? "/signup" : "/setup"}>
              {configured ? "Start workspace" : "Configure app"}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-16 lg:grid-cols-[1.05fr_.95fr] lg:px-8 lg:pb-28 lg:pt-24">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-teal-800">
              <Sparkles className="size-3.5" /> Evidence before eloquence
            </div>
            <h1 className="max-w-3xl text-balance font-serif text-5xl leading-[1.04] font-semibold tracking-[-0.035em] text-slate-950 sm:text-6xl lg:text-7xl">
              Better assignments begin with a verifiable process.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600">
              ScholarFlow AI turns course materials, rubrics, and research into
              a supervised writing workflow with traceable citations,
              independent review, and student-controlled approval.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" variant="accent">
                <Link href={configured ? "/signup" : "/setup"}>
                  Build your workspace
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <a href="#workflow">See how it works</a>
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="size-4 text-teal-600" /> Local Ollama
                support
              </span>
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="size-4 text-teal-600" /> Private course
                library
              </span>
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="size-4 text-teal-600" /> No automatic
                submission
              </span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-8 rounded-full bg-teal-200/35 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 p-3 shadow-2xl shadow-slate-900/15">
              <div className="rounded-[1.4rem] bg-white p-6 sm:p-8">
                <div className="mb-7 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">
                      Workflow
                    </p>
                    <h2 className="mt-1 text-xl font-semibold">
                      Assignment review loop
                    </h2>
                  </div>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                    Student supervised
                  </span>
                </div>
                <div className="space-y-3">
                  {agents.map((agent, index) => (
                    <div
                      key={agent.label}
                      className="flex gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4"
                    >
                      <span
                        className={`grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold ${agent.tone}`}
                      >
                        {agent.label.slice(-1)}
                      </span>
                      <div>
                        <div className="flex items-baseline gap-2">
                          <p className="font-semibold text-slate-900">
                            {agent.name}
                          </p>
                          <span className="text-xs text-slate-400">
                            0{index + 1}
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          {agent.copy}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 rounded-2xl bg-teal-600 p-4 text-white">
                  <p className="text-sm font-semibold">Quality gate</p>
                  <p className="mt-1 text-sm text-teal-50">
                    Critical issues resolved · citations traceable · student
                    approval still required
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="workflow" className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 md:grid-cols-3 lg:px-8">
            {[
              {
                icon: Database,
                title: "Course knowledge first",
                copy: "Retrieval prioritizes your brief, rubric, lecture notes, readings, and feedback before optional web research.",
              },
              {
                icon: FileSearch,
                title: "Every claim inspectable",
                copy: "Evidence carries document, page or section, chunk, relevance, limitations, and conflict metadata.",
              },
              {
                icon: ShieldCheck,
                title: "Human approval is the gate",
                copy: "The system surfaces uncertainty and unresolved defects. You decide when a draft is ready to export.",
              },
            ].map(({ icon: Icon, title, copy }) => (
              <article
                key={title}
                className="rounded-2xl border border-slate-200 p-6"
              >
                <span className="grid size-11 place-items-center rounded-xl bg-slate-950 text-white">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">{copy}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <p>ScholarFlow AI · Evidence-led academic work.</p>
        <p>AI guidance is not a guaranteed grade.</p>
      </footer>
    </div>
  );
}
