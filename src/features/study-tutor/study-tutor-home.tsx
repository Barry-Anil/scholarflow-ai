"use client";

import {
  BookOpenCheck,
  FileText,
  LoaderCircle,
  Trash2,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import {
  createStudyDocumentProgress,
  type StudyDocumentProgress,
} from "./processing-progress";
import { StudyProcessingDetails } from "./study-processing-details";

type SessionSummary = {
  id: string;
  title: string;
  status: string;
  filename: string | null;
  sectionCount: number;
  processing: StudyDocumentProgress;
  lastActivityAt: Date;
  createdAt: Date;
};

export function StudyTutorHome({ sessions }: { sessions: SessionSummary[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRun = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [upload, setUpload] = useState<{
    state: "idle" | "uploading" | "processing" | "error";
    percent: number;
    message?: string;
    processing?: StudyDocumentProgress;
  }>({
    state: "idle",
    percent: 0,
  });
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => () => void (pollRun.current += 1), []);

  useEffect(() => {
    if (!sessions.some((session) => session.status === "processing")) return;
    const timer = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [router, sessions]);

  async function waitForProcessing(sessionId: string) {
    const run = ++pollRun.current;
    while (pollRun.current === run) {
      try {
        const response = await fetch(`/api/study-tutor/sessions/${sessionId}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          status?: string;
          error?: string;
          processing?: StudyDocumentProgress;
        };
        if (!response.ok)
          throw new Error(payload.error ?? "Session status is unavailable.");
        if (payload.processing) {
          setUpload((current) => ({
            ...current,
            state: "processing",
            percent: 100,
            processing: payload.processing,
          }));
        }
        if (payload.status === "ready") {
          router.push(`/study-tutor/${sessionId}`);
          return;
        }
        if (payload.status === "failed") {
          setUpload({
            state: "error",
            percent: 0,
            message: payload.error ?? "The notes could not be processed.",
          });
          return;
        }
      } catch (statusError) {
        setUpload({
          state: "error",
          percent: 0,
          message:
            statusError instanceof Error
              ? statusError.message
              : "Session status is unavailable.",
        });
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
  }

  function uploadFile(file?: File) {
    if (!file) return;
    const data = new FormData();
    data.set("document", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/study-tutor/upload");
    setUpload({ state: "uploading", percent: 0 });
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      setUpload({
        state: percent === 100 ? "processing" : "uploading",
        percent,
      });
    };
    xhr.upload.onload = () =>
      setUpload({
        state: "processing",
        percent: 100,
        processing: createStudyDocumentProgress("queued", ["stored"]),
      });
    xhr.onload = () => {
      let payload: { sessionId?: string; error?: string } = {};
      try {
        payload = JSON.parse(xhr.responseText) as typeof payload;
      } catch {
        /* handled below */
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload.sessionId) {
        setUpload({
          state: "processing",
          percent: 100,
          processing: createStudyDocumentProgress("queued", ["stored"]),
        });
        void waitForProcessing(payload.sessionId);
        return;
      }
      setUpload({
        state: "error",
        percent: 0,
        message: payload.error ?? "The upload could not be processed.",
      });
    };
    xhr.onerror = () =>
      setUpload({
        state: "error",
        percent: 0,
        message: "The upload was interrupted.",
      });
    xhr.send(data);
  }

  async function deleteSession(id: string, title: string) {
    if (!window.confirm(`Delete “${title}” and its uploaded notes?`)) return;
    setDeleting(id);
    const response = await fetch(`/api/study-tutor/sessions/${id}`, {
      method: "DELETE",
    });
    setDeleting(null);
    if (response.ok) router.refresh();
  }

  return (
    <main className="p-5 lg:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-semibold text-teal-700">
              Learn from your own material
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
              Study Tutor
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Upload notes, study one real section at a time, ask grounded
              questions, and listen with browser or Inworld speech.
            </p>
          </div>
        </div>

        <Card className="mt-8 p-6">
          <button
            type="button"
            className={`flex w-full flex-col items-center rounded-2xl border border-dashed p-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 ${dragging ? "border-teal-400 bg-teal-50" : "border-slate-300 bg-slate-50/70 hover:border-teal-300"}`}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              uploadFile(event.dataTransfer.files[0]);
            }}
            disabled={
              upload.state === "uploading" || upload.state === "processing"
            }
          >
            {upload.state === "uploading" || upload.state === "processing" ? (
              <LoaderCircle
                className="size-8 animate-spin text-teal-600"
                aria-hidden="true"
              />
            ) : (
              <UploadCloud
                className="size-8 text-teal-600"
                aria-hidden="true"
              />
            )}
            <span className="mt-3 text-sm font-semibold text-slate-900">
              {upload.state === "processing"
                ? "Extracting and indexing your notes…"
                : "Drop notes here or choose a file"}
            </span>
            <span className="mt-1 text-xs text-slate-500">
              PDF, DOCX, PPTX, or TXT · maximum 25 MB
            </span>
            {(upload.state === "uploading" ||
              upload.state === "processing") && (
              <div className="mt-4 w-full max-w-sm" aria-live="polite">
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-teal-600"
                    style={{ width: `${upload.percent}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {upload.state === "uploading"
                    ? `${upload.percent}% uploaded`
                    : "Upload complete. Processing real document text."}
                </p>
              </div>
            )}
          </button>
          {upload.state === "processing" && upload.processing && (
            <div className="mx-auto mt-4 max-w-2xl">
              <StudyProcessingDetails
                progress={upload.processing}
                defaultExpanded
              />
            </div>
          )}
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".pdf,.docx,.pptx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain"
            onChange={(event) => uploadFile(event.target.files?.[0])}
          />
          {upload.state === "error" && (
            <p className="mt-3 text-sm font-medium text-rose-600" role="alert">
              {upload.message}
            </p>
          )}
        </Card>

        <section className="mt-8" aria-labelledby="sessions-heading">
          <div className="flex items-center justify-between">
            <h2
              id="sessions-heading"
              className="text-xl font-semibold tracking-tight text-slate-950"
            >
              Your study sessions
            </h2>
            <span className="text-xs font-medium text-slate-500">
              {sessions.length} total
            </span>
          </div>
          {sessions.length ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sessions.map((session) => (
                <Card
                  key={session.id}
                  className="group min-w-0 p-5 transition-colors hover:border-teal-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="rounded-xl bg-teal-50 p-2.5 text-teal-700">
                      <BookOpenCheck className="size-5" />
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete ${session.title}`}
                      className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
                      disabled={deleting === session.id}
                      onClick={() => deleteSession(session.id, session.title)}
                    >
                      {deleting === session.id ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </button>
                  </div>
                  <Link
                    href={`/study-tutor/${session.id}`}
                    title={session.title}
                    className="mt-4 block min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30"
                  >
                    <h3 className="line-clamp-2 max-w-full break-words font-semibold text-slate-950 [overflow-wrap:anywhere] group-hover:text-teal-800">
                      {session.title}
                    </h3>
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
                      <FileText className="size-3.5 shrink-0" />
                      <span
                        className="truncate"
                        title={session.filename ?? undefined}
                      >
                        {session.filename}
                      </span>
                    </p>
                    <div className="mt-4 flex items-center justify-between text-xs">
                      <span
                        className={
                          session.status === "ready"
                            ? "font-semibold text-teal-700"
                            : session.status === "failed"
                              ? "font-semibold text-rose-600"
                              : "font-semibold text-amber-700"
                        }
                      >
                        {session.status}
                      </span>
                      <span className="text-slate-500">
                        {session.sectionCount} sections
                      </span>
                    </div>
                  </Link>
                  <StudyProcessingDetails
                    progress={session.processing}
                    defaultExpanded={session.status === "processing"}
                  />
                </Card>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-10 text-center">
              <BookOpenCheck className="mx-auto size-8 text-slate-400" />
              <p className="mt-3 font-semibold text-slate-800">
                No study sessions yet
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Upload real notes above to create your first session.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
