"use client";

import { FileUp, LoaderCircle } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type KnowledgeActionState, uploadDocumentAction } from "./actions";

const initialState: KnowledgeActionState = { status: "idle" };

export function UploadDocumentForm({ courseId }: { courseId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const action = uploadDocumentAction.bind(null, courseId);
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state.status]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-5">
        <label
          htmlFor="knowledge-document"
          className="mb-2 block text-sm font-semibold text-slate-800"
        >
          Course material
        </label>
        <Input
          id="knowledge-document"
          name="document"
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,.csv,.ipynb,.py,.js,.ts,.jsx,.tsx,.mjs,.cjs,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,application/x-ipynb+json,text/x-python,text/javascript,application/javascript,text/typescript,application/typescript"
          required
          disabled={pending}
          className="cursor-pointer bg-white file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-slate-700"
        />
        <p className="mt-2 text-xs leading-5 text-slate-500">
          PDF, DOCX, TXT, Markdown, CSV, IPYNB, PY, JS, or TS. Maximum 25 MB per
          document.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          className={
            state.status === "error"
              ? "text-sm font-medium text-rose-600"
              : "text-sm font-medium text-teal-700"
          }
          role="status"
          aria-live="polite"
        >
          {state.message ??
            "Files remain private and are indexed only for this course."}
        </p>
        <Button type="submit" variant="accent" disabled={pending}>
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <FileUp className="size-4" />
          )}
          {pending ? "Uploading and indexing…" : "Upload material"}
        </Button>
      </div>
    </form>
  );
}
