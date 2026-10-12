import {
  Check,
  Circle,
  Download,
  FileDown,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { approveDraftAction, startExportAction } from "./actions";
import { APPROVAL_ATTESTATION } from "./approval";
import type { ExportFormat } from "./contracts";

type ApprovalCheck = { key: string; label: string; passed: boolean };
type ExportRecord = {
  id: string;
  format: ExportFormat;
  filename: string | null;
  sizeBytes: number | null;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  errorMessage: string | null;
  completedAt: Date | null;
  createdAt: Date;
};

export function ApprovalExportPanel({
  courseId,
  assignmentId,
  draftVersion,
  approval,
  checks,
  ready,
  exportBusy,
  exports,
  readOnly = false,
}: {
  courseId: string;
  assignmentId: string;
  draftVersion: number | null;
  approval: { approvedAt: Date } | null;
  checks: ApprovalCheck[];
  ready: boolean;
  exportBusy: boolean;
  exports: ExportRecord[];
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-teal-600" />
          <p className="text-sm font-semibold text-slate-800">
            Student approval
          </p>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Approval locks one exact draft version. It is not university
          submission or a guarantee of correctness.
        </p>
      </div>
      <ul className="space-y-2">
        {checks.map((check) => (
          <li
            key={check.key}
            className="flex items-start gap-2 text-xs leading-5 text-slate-600"
          >
            {check.passed ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-teal-600" />
            ) : (
              <Circle className="mt-0.5 size-3.5 shrink-0 text-slate-300" />
            )}
            {check.label}
          </li>
        ))}
      </ul>
      {approval ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-teal-800">
            <LockKeyhole className="size-3.5" />
            Draft version {draftVersion} approved
          </p>
          <p className="mt-1 text-[11px] text-teal-700">
            {formatTimestamp(approval.approvedAt)}
          </p>
        </div>
      ) : readOnly ? (
        <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
          An editor or the course owner must approve this draft.
        </p>
      ) : (
        <form
          action={approveDraftAction.bind(null, courseId, assignmentId)}
          className="space-y-3"
        >
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs leading-5 text-slate-600">
            <input
              type="checkbox"
              name="attestation"
              required
              disabled={!ready}
              className="mt-1 size-4 rounded border-slate-300 accent-teal-600"
            />
            {APPROVAL_ATTESTATION}
          </label>
          <Button
            type="submit"
            variant="accent"
            size="sm"
            className="w-full"
            disabled={!ready}
          >
            <LockKeyhole className="size-4" /> Approve this version
          </Button>
        </form>
      )}

      <div className="border-t border-slate-200 pt-5">
        <div className="flex items-center gap-2">
          <FileDown className="size-5 text-teal-600" />
          <p className="text-sm font-semibold text-slate-800">
            Private exports
          </p>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Each export is audited and downloaded through a short-lived link.
        </p>
        {!readOnly && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(["markdown", "docx", "pdf"] as const).map((format) => (
              <form
                key={format}
                action={startExportAction.bind(
                  null,
                  courseId,
                  assignmentId,
                  format,
                )}
              >
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  className="w-full px-2"
                  disabled={!approval || exportBusy}
                >
                  {format === "markdown" ? "MD" : format.toUpperCase()}
                </Button>
              </form>
            ))}
          </div>
        )}
      </div>

      {exports.length > 0 && (
        <ol className="space-y-2 border-t border-slate-200 pt-5">
          {exports.slice(0, 6).map((record) => (
            <li
              key={record.id}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-slate-800">
                    {record.filename ?? `${record.format.toUpperCase()} export`}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {exportStatus(record)}
                  </p>
                </div>
                {record.status === "completed" && (
                  <Button asChild variant="ghost" size="icon">
                    <Link
                      href={`/api/exports/${record.id}/download`}
                      aria-label={`Download ${record.filename ?? record.format}`}
                    >
                      <Download className="size-4" />
                    </Link>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function exportStatus(record: ExportRecord) {
  if (record.status === "completed")
    return `${record.sizeBytes ? formatBytes(record.sizeBytes) : "Ready"} - ${record.completedAt ? formatTimestamp(record.completedAt) : "completed"}`;
  if (record.status === "failed")
    return record.errorMessage ?? "Export failed after the allowed retries.";
  if (record.status === "cancelled") return "Cancelled";
  return record.status === "processing" ? "Generating..." : "Queued";
}

function formatTimestamp(value: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
