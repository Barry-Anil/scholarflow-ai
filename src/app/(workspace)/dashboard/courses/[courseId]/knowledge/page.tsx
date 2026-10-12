import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FileText,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { retryDocumentAction } from "@/features/knowledge/actions";
import {
  getKnowledgeBaseData,
  searchKnowledgeBase,
} from "@/features/knowledge/data";
import { UploadDocumentForm } from "@/features/knowledge/upload-document-form";
import { EmbeddingBackfillForm } from "@/features/knowledge/embedding-backfill-form";

type PageProps = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
};

const statusPresentation = {
  uploaded: { label: "Uploaded", tone: "bg-slate-100 text-slate-700" },
  queued: { label: "Queued", tone: "bg-amber-50 text-amber-800" },
  processing: { label: "Processing", tone: "bg-sky-50 text-sky-800" },
  ready: { label: "Ready", tone: "bg-teal-50 text-teal-800" },
  partially_processed: {
    label: "Partial",
    tone: "bg-amber-50 text-amber-800",
  },
  failed: { label: "Failed", tone: "bg-rose-50 text-rose-700" },
} as const;

export default function KnowledgePage(props: PageProps) {
  return (
    <Suspense fallback={<KnowledgeLoadingState />}>
      <KnowledgeContent {...props} />
    </Suspense>
  );
}

async function KnowledgeContent({ params, searchParams }: PageProps) {
  await connection();
  const [{ courseId }, queryValues] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(courseId).success) notFound();

  const data = await getKnowledgeBaseData(courseId);
  if (!data) notFound();
  const query = Array.isArray(queryValues.q)
    ? (queryValues.q[0] ?? "")
    : (queryValues.q ?? "");
  const search = await searchKnowledgeBase(courseId, query);
  const canEdit = data.role === "owner" || data.role === "editor";

  return (
    <main className="p-5 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" /> Back to dashboard
            </Link>
          </Button>
          <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-semibold text-teal-700">
                {data.course.code || "Course workspace"}
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
                {data.course.title} knowledge base
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                Upload trusted course evidence, inspect its processing state,
                and search the exact text agents will use later.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-500">
                {data.materials.length} document
                {data.materials.length === 1 ? "" : "s"}
              </div>
              <Button asChild variant="accent" size="sm">
                <Link href={`/dashboard/courses/${courseId}/assignments`}>
                  <ClipboardList className="size-4" /> Assignments
                </Link>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/dashboard/courses/${courseId}/members`}>
                  <Users className="size-4" /> Members
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {canEdit && (
          <Card>
            <CardHeader>
              <CardTitle>Add course material</CardTitle>
              <CardDescription>
                Text is extracted on the server and split into attributable
                retrieval chunks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UploadDocumentForm courseId={courseId} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
                <Sparkles className="size-5" />
              </span>
              <div>
                <p className="font-semibold text-slate-900">
                  Semantic coverage
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {data.coverage.embedded} of {data.coverage.total} searchable
                  chunks have local embeddings.
                </p>
              </div>
            </div>
            {canEdit && data.coverage.total > data.coverage.embedded && (
              <EmbeddingBackfillForm
                courseId={courseId}
                remaining={data.coverage.total - data.coverage.embedded}
              />
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
          <Card>
            <CardHeader>
              <CardTitle>Indexed materials</CardTitle>
              <CardDescription>
                Processing failures stay visible and can be retried safely.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.materials.length ? (
                <div className="divide-y divide-slate-100">
                  {data.materials.map((material) => {
                    const status = statusPresentation[material.status];
                    const canRetry =
                      canEdit &&
                      material.status === "failed" &&
                      material.jobId &&
                      (material.attempts ?? 0) < (material.maxAttempts ?? 0);
                    return (
                      <div
                        key={material.id}
                        className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                      >
                        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                          <FileText className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-slate-900">
                            {material.filename}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatBytes(material.sizeBytes)} ·{" "}
                            {material.chunkCount} searchable chunk
                            {material.chunkCount === 1 ? "" : "s"}
                          </p>
                          {material.errorMessage && (
                            <p className="mt-2 text-xs font-medium text-rose-600">
                              {material.errorMessage}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}
                          >
                            {status.label}
                          </span>
                          {canRetry && (
                            <form
                              action={retryDocumentAction.bind(
                                null,
                                courseId,
                                material.jobId!,
                              )}
                            >
                              <Button
                                type="submit"
                                variant="secondary"
                                size="sm"
                              >
                                Retry
                              </Button>
                            </form>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
                  <FileText className="mx-auto size-7 text-slate-300" />
                  <p className="mt-3 font-medium text-slate-700">
                    No course material yet
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Upload the first source to establish this course&apos;s
                    evidence base.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Search extracted evidence</CardTitle>
              <CardDescription>
                Keyword and semantic ranks are fused when Ollama is available;
                search falls back safely to keywords when it is not.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex gap-2" action="" method="get">
                <Input
                  name="q"
                  defaultValue={query}
                  placeholder="Search a concept, theory, or term…"
                  minLength={2}
                />
                <Button type="submit" size="icon" aria-label="Search evidence">
                  <Search className="size-4" />
                </Button>
              </form>
              {query.trim().length >= 2 && (
                <div className="mt-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      search.mode === "hybrid"
                        ? "bg-teal-50 text-teal-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {search.mode === "hybrid"
                      ? `Hybrid retrieval · ${search.model}`
                      : "Keyword fallback"}
                  </span>
                </div>
              )}
              <div className="mt-5 space-y-3">
                {query.trim().length >= 2 && !search.results.length ? (
                  <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                    No indexed passage matches this search.
                  </div>
                ) : (
                  search.results.map((result) => (
                    <article
                      key={result.id}
                      className="rounded-xl border border-slate-200 bg-white p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-xs font-semibold text-teal-700">
                          {result.filename}
                        </p>
                        {result.pageStart && (
                          <span className="shrink-0 text-xs text-slate-400">
                            Page {result.pageStart}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {result.content.slice(0, 420)}
                        {result.content.length > 420 ? "…" : ""}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: CheckCircle2,
              title: "Private storage",
              description: "Files are never public.",
            },
            {
              icon: Search,
              title: "Attributable search",
              description: "Every result names its source.",
            },
            {
              icon: AlertTriangle,
              title: "Visible failures",
              description: "Nothing silently disappears.",
            },
          ].map(({ icon: Icon, title, description }) => (
            <div
              key={String(title)}
              className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-teal-600" />
              <div>
                <p className="text-sm font-semibold text-slate-800">{title}</p>
                <p className="mt-1 text-xs text-slate-500">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function KnowledgeLoadingState() {
  return (
    <main className="p-5 lg:p-8" aria-busy="true" aria-live="polite">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm font-semibold text-teal-700">Knowledge base</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
          Loading course evidence…
        </h1>
        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          {[0, 1].map((item) => (
            <div
              key={item}
              className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-sm"
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
