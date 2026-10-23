"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const toneClasses: Record<Tone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  success: "border-teal-200 bg-teal-50 text-teal-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
};

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Re-renders on an interval so relative times and elapsed timers stay current. */
export function useNow(intervalMs: number, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);
  return now;
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatRelative(iso: string | null, now: number) {
  if (!iso) return "Never";
  const delta = now - Date.parse(iso);
  if (delta < 5_000) return "just now";
  return `${formatDuration(delta)} ago`;
}

export function formatClock(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

export function CopyableId({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <code
        className="truncate rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700"
        title={value}
      >
        {value.slice(0, 8)}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => undefined);
        }}
        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-hidden"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
      >
        {copied ? (
          <Check className="size-3.5 text-teal-600" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </span>
  );
}

export function DeterminateProgress({
  label,
  percent,
  tone = "success",
  caption,
}: {
  label: string;
  percent: number;
  tone?: "success" | "danger" | "warning";
  caption?: ReactNode;
}) {
  const bar =
    tone === "danger"
      ? "bg-rose-500"
      : tone === "warning"
        ? "bg-amber-500"
        : "bg-teal-600";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="font-semibold text-slate-800 tabular-nums">
          {percent}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-slate-100"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            bar,
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {caption && <p className="mt-1 text-[11px] text-slate-500">{caption}</p>}
    </div>
  );
}

/** No aria-valuenow: the remaining work inside a model call is not measurable. */
export function IndeterminateProgress({
  label,
  caption,
  active,
}: {
  label: string;
  caption?: ReactNode;
  active: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-700">{label}</p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuetext={active ? "In progress" : "Not running"}
        className="relative h-1.5 overflow-hidden rounded-full bg-slate-100"
      >
        {active && (
          <div className="absolute inset-y-0 w-1/3 rounded-full bg-sky-400 motion-safe:animate-[monitor-indeterminate_1.6s_ease-in-out_infinite] motion-reduce:w-full motion-reduce:opacity-40" />
        )}
      </div>
      {caption && <p className="mt-1 text-[11px] text-slate-500">{caption}</p>}
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 min-w-0 text-xs text-slate-700">{children}</dd>
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs leading-5 text-slate-500">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-500">
      {children}
    </p>
  );
}
