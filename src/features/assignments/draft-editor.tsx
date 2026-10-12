"use client";

import {
  CheckCircle2,
  ExternalLink,
  Link2,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  citationLocator,
  citationTitle,
  citationUrl,
  citationVerificationLabel,
  type CitationLike,
} from "@/features/exports/citation-format";
import { saveDraftAction, type AssignmentActionState } from "./actions";

const initialState: AssignmentActionState = { status: "idle" };

type EditorQuestion = {
  id: string;
  position: number;
  prompt: string;
  requirements: string[];
  wordLimit: number | null;
  answer: string;
  confidenceScore: number;
  confidenceReasons: string[];
  citationCount: number;
  citations: CitationLike[];
};

export function DraftEditor({
  assignmentId,
  questions,
  isAgentDraft,
  busy,
  readOnly = false,
}: {
  assignmentId: string;
  questions: EditorQuestion[];
  isAgentDraft: boolean;
  busy: boolean;
  readOnly?: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveDraftAction.bind(null, assignmentId),
    initialState,
  );

  return (
    <form action={action} className="space-y-5">
      {questions.map((question, index) => (
        <section
          key={question.id}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
              Question {index + 1}
            </p>
            {question.wordLimit && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {question.wordLimit.toLocaleString()} words
              </span>
            )}
          </div>
          <h3 className="mt-2 font-semibold leading-6 text-slate-950">
            {question.prompt}
          </h3>
          {question.requirements.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-slate-500">
              {question.requirements.map((requirement) => (
                <li key={requirement} className="flex gap-2">
                  <span aria-hidden="true" className="text-teal-500">
                    •
                  </span>
                  {requirement}
                </li>
              ))}
            </ul>
          )}
          {isAgentDraft && (
            <div className="mt-4 flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:flex-row sm:items-center">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-teal-600" />
                <div>
                  <p className="text-xs font-semibold text-slate-700">
                    Confidence {question.confidenceScore}/100 ·{" "}
                    {confidenceLabel(question.confidenceScore)}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {question.confidenceReasons[0] ??
                      "No confidence explanation was recorded."}
                  </p>
                </div>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-slate-600">
                <Link2 className="size-3.5 text-teal-600" />
                {question.citationCount} citation
                {question.citationCount === 1 ? "" : "s"}
              </span>
            </div>
          )}
          <label
            htmlFor={`answer-${question.id}`}
            className="mt-5 block text-sm font-medium text-slate-700"
          >
            Draft answer (Markdown)
          </label>
          <Textarea
            id={`answer-${question.id}`}
            name={`answer-${question.id}`}
            className="mt-2 min-h-64 font-mono text-[13px]"
            defaultValue={question.answer}
            disabled={busy}
            readOnly={readOnly}
            placeholder="Build your answer here. Use citations such as (Author, Year) and keep claims tied to evidence."
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                if (!readOnly) event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {question.citations.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Evidence citations
              </p>
              <ol className="mt-2 space-y-2">
                {question.citations.map((citation, citationIndex) => {
                  const url = citationUrl(citation);
                  return (
                    <li
                      key={
                        citation.id ?? `${citation.sourceId}-${citationIndex}`
                      }
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800">
                            [{citationIndex + 1}] {citationTitle(citation)}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-600">
                            Supports: {citation.claimText}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {citationLocator(citation) ??
                              "No page or section locator stored"}
                          </p>
                        </div>
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open source for citation ${citationIndex + 1}`}
                            className="shrink-0 rounded-lg p-1.5 text-teal-700 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        )}
                      </div>
                      <p
                        className={`mt-2 flex items-center gap-1.5 text-[11px] font-semibold ${citation.verified ? "text-teal-700" : "text-amber-700"}`}
                      >
                        <CheckCircle2 className="size-3.5" />
                        {citationVerificationLabel(citation)}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </section>
      ))}
      <div className="flex flex-col items-stretch justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur sm:sticky sm:bottom-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            {readOnly
              ? "You have read-only access to this workspace"
              : busy
                ? "Agent B is preparing the next draft version"
                : "Every save creates a recoverable version"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {readOnly
              ? "Ask the course owner to change your role if you need to edit."
              : busy
                ? "Editing resumes when every question has completed."
                : "Press Ctrl/⌘ + Enter from an answer to save quickly."}
          </p>
          {state.message && (
            <p
              role="status"
              className={`mt-1 text-xs font-medium ${
                state.status === "error" ? "text-rose-600" : "text-teal-700"
              }`}
            >
              {state.message}
            </p>
          )}
        </div>
        {!readOnly && (
          <Button type="submit" variant="accent" disabled={pending || busy}>
            <Save className="size-4" />
            {pending
              ? "Saving version…"
              : busy
                ? "Agent draft in progress…"
                : "Save new version"}
          </Button>
        )}
      </div>
    </form>
  );
}

function confidenceLabel(score: number) {
  if (score >= 90) return "High";
  if (score >= 75) return "Good";
  if (score >= 50) return "Moderate";
  return "Low";
}
