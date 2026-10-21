"use client";

import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Minus,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import {
  computeRubricScale,
  type CriterionProgress,
  type RubricScaleSummary,
  type ScaleLevel,
} from "@/features/assignments/rubric-scale";
import { cn } from "@/lib/utils";

export type DrawerTab = "rubric" | "activity" | "brief";

export function openWorkspaceDrawer(tab: DrawerTab = "rubric") {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("open-workspace-drawer", { detail: tab }),
    );
  }
}

export function DrawerTriggerButton({
  tab,
  children,
  className,
  variant = "secondary",
  size = "sm",
}: {
  tab: DrawerTab;
  children: ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "ghost" | "accent";
  size?: "sm" | "md" | "lg" | "icon";
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => openWorkspaceDrawer(tab)}
    >
      {children}
    </Button>
  );
}

type WorkspaceDrawerProps = {
  courseId: string;
  assignmentId: string;
  assignmentTitle: string;
  briefMarkdown: string;
  questions: Array<{
    id: string;
    prompt: string;
    wordLimit: number | null;
    position: number;
  }>;
  criteria: Array<{
    id: string;
    title: string;
    description: string;
    weight: number | null;
    position: number;
  }>;
  answers: Array<{
    questionId: string;
    markdown: string;
    confidenceScore?: number;
  }>;
  hasDraft: boolean;
  draftVersion?: number | null;
  reviewItems?: Array<{
    id: string;
    rubricCriterionId?: string | null;
    severity: string;
    title: string;
    recommendedCorrection: string;
    resolution: string;
  }>;
  previousReviewItems?: Array<{
    id: string;
    rubricCriterionId?: string | null;
    severity: string;
    title: string;
    recommendedCorrection: string;
    resolution: string;
  }>;
  hasReviewReport?: boolean;
  hasPreviousReviewReport?: boolean;
  events: Array<{
    id: string;
    eventType: string;
    message: string;
    createdAt: Date | string;
  }>;
};

export function WorkspaceDrawerBar({
  onOpenTab,
  rubricSummary,
  eventCount,
}: {
  onOpenTab: (tab: DrawerTab) => void;
  rubricSummary: RubricScaleSummary;
  eventCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-2.5 shadow-xs backdrop-blur-md">
      <div className="flex items-center gap-2 px-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Quick Access:
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onOpenTab("rubric")}
          className="group border-slate-200/90 hover:border-teal-400 hover:bg-teal-50/60"
        >
          <BookOpenCheck className="size-4 text-teal-600 transition-transform group-hover:scale-110" />
          <span className="font-semibold text-slate-800">Marking rubric</span>
          <span className="ml-1 rounded-full bg-teal-100/80 px-2 py-0.5 text-[11px] font-bold text-teal-800">
            {rubricSummary.overallScore}% scale
          </span>
          {rubricSummary.overallTrend === "better" && (
            <span className="flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
              <ArrowUpRight className="size-3" /> Better
            </span>
          )}
          {rubricSummary.overallTrend === "regressed" && (
            <span className="flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
              <ArrowDownRight className="size-3" /> Regressed
            </span>
          )}
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onOpenTab("activity")}
          className="group border-slate-200/90 hover:border-teal-400 hover:bg-teal-50/60"
        >
          <Activity className="size-4 text-teal-600 transition-transform group-hover:scale-110" />
          <span className="font-semibold text-slate-800">Agent activity</span>
          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {eventCount}
          </span>
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onOpenTab("brief")}
          className="group border-slate-200/90 hover:border-teal-400 hover:bg-teal-50/60"
        >
          <FileText className="size-4 text-teal-600 transition-transform group-hover:scale-110" />
          <span className="font-semibold text-slate-800">Original brief</span>
        </Button>
      </div>
    </div>
  );
}

export function WorkspaceDrawerManager(props: WorkspaceDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>("rubric");

  const rubricSummary = useMemo(() => {
    return computeRubricScale({
      criteria: props.criteria,
      hasDraft: props.hasDraft,
      answers: props.answers,
      reviewItems: props.reviewItems,
      previousReviewItems: props.previousReviewItems,
      hasReviewReport: props.hasReviewReport,
      hasPreviousReviewReport: props.hasPreviousReviewReport,
    });
  }, [
    props.criteria,
    props.hasDraft,
    props.answers,
    props.reviewItems,
    props.previousReviewItems,
    props.hasReviewReport,
    props.hasPreviousReviewReport,
  ]);

  const handleOpen = (tab: DrawerTab) => {
    setActiveTab(tab);
    setIsOpen(true);
  };

  useEffect(() => {
    const handleCustomOpen = (event: Event) => {
      const customEvent = event as CustomEvent<DrawerTab>;
      if (customEvent.detail) {
        setActiveTab(customEvent.detail);
      }
      setIsOpen(true);
    };

    window.addEventListener("open-workspace-drawer", handleCustomOpen);
    return () => {
      window.removeEventListener("open-workspace-drawer", handleCustomOpen);
    };
  }, []);

  return (
    <>
      <WorkspaceDrawerBar
        onOpenTab={handleOpen}
        rubricSummary={rubricSummary}
        eventCount={props.events.length}
      />

      <Drawer
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={
          activeTab === "rubric"
            ? "Marking rubric"
            : activeTab === "activity"
              ? "Agent activity"
              : "Original brief"
        }
        description={
          activeTab === "rubric"
            ? "Keep each answer aligned with how it will be assessed."
            : activeTab === "activity"
              ? "Track live agent operations, review cycles, and background tasks."
              : "Reference the assignment instructions, questions, and research policy."
        }
        headerActions={
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setActiveTab("rubric")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                activeTab === "rubric"
                  ? "bg-teal-600 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <BookOpenCheck className="size-3.5" />
              <span>Rubric scale</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[10px]",
                  activeTab === "rubric"
                    ? "bg-teal-700 text-teal-100"
                    : "bg-slate-100 text-slate-600",
                )}
              >
                {rubricSummary.overallScore}%
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("activity")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                activeTab === "activity"
                  ? "bg-teal-600 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <Activity className="size-3.5" />
              <span>Activity</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[10px]",
                  activeTab === "activity"
                    ? "bg-teal-700 text-teal-100"
                    : "bg-slate-100 text-slate-600",
                )}
              >
                {props.events.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("brief")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                activeTab === "brief"
                  ? "bg-teal-600 text-white shadow-xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )}
            >
              <FileText className="size-3.5" />
              <span>Brief</span>
            </button>
          </div>
        }
      >
        {activeTab === "rubric" && (
          <RubricScaleDrawerContent
            rubricSummary={rubricSummary}
            draftVersion={props.draftVersion}
          />
        )}
        {activeTab === "activity" && (
          <AgentActivityDrawerContent events={props.events} />
        )}
        {activeTab === "brief" && (
          <OriginalBriefDrawerContent
            briefMarkdown={props.briefMarkdown}
            courseId={props.courseId}
            questions={props.questions}
          />
        )}
      </Drawer>
    </>
  );
}

/* ========================================================================= */
/* 1. RUBRIC SCALE DRAWER CONTENT                                            */
/* ========================================================================= */

function RubricScaleDrawerContent({
  rubricSummary,
  draftVersion,
}: {
  rubricSummary: RubricScaleSummary;
  draftVersion?: number | null;
}) {
  const [filter, setFilter] = useState<
    "all" | "at_risk" | "developing" | "proficient" | "better"
  >("all");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputId = useId();

  const filteredCriteria = useMemo(() => {
    return rubricSummary.criteria.filter((c) => {
      if (filter === "at_risk" && c.scaleLevel !== "at_risk") return false;
      if (filter === "developing" && c.scaleLevel !== "developing")
        return false;
      if (
        filter === "proficient" &&
        c.scaleLevel !== "proficient" &&
        c.scaleLevel !== "exemplary"
      )
        return false;
      if (filter === "better" && c.trend !== "better") return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          c.title.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [rubricSummary.criteria, filter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Scale Performance Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-850 to-slate-950 p-5 text-white shadow-md">
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-teal-400">
                Rubric Alignment Scale
                {draftVersion ? ` · Draft v${draftVersion}` : ""}
              </p>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-4xl font-extrabold tracking-tight text-white">
                  {rubricSummary.overallScore}
                  <span className="text-xl font-medium text-slate-400">
                    /100
                  </span>
                </span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                    rubricSummary.overallScaleLevel === "exemplary" &&
                      "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
                    rubricSummary.overallScaleLevel === "proficient" &&
                      "bg-teal-500/20 text-teal-300 border border-teal-500/40",
                    rubricSummary.overallScaleLevel === "developing" &&
                      "bg-amber-500/20 text-amber-300 border border-amber-500/40",
                    rubricSummary.overallScaleLevel === "at_risk" &&
                      "bg-rose-500/20 text-rose-300 border border-rose-500/40",
                  )}
                >
                  {rubricSummary.overallScaleLabel}
                </span>
              </div>
            </div>

            {/* Better / Worse Trend Banner */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-xs">
              <p className="text-[11px] font-medium text-slate-400">
                Scale trajectory:
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                {rubricSummary.overallTrend === "better" && (
                  <span className="flex items-center gap-1 text-sm font-bold text-emerald-400">
                    <TrendingUp className="size-4" />
                    Better on scale
                    {rubricSummary.overallDelta !== null && (
                      <span className="text-xs font-medium">
                        (+{rubricSummary.overallDelta} pts)
                      </span>
                    )}
                  </span>
                )}
                {rubricSummary.overallTrend === "regressed" && (
                  <span className="flex items-center gap-1 text-sm font-bold text-rose-400">
                    <TrendingDown className="size-4" />
                    Regressed on scale
                    {rubricSummary.overallDelta !== null && (
                      <span className="text-xs font-medium">
                        ({rubricSummary.overallDelta} pts)
                      </span>
                    )}
                  </span>
                )}
                {rubricSummary.overallTrend === "stable" && (
                  <span className="flex items-center gap-1 text-sm font-medium text-slate-300">
                    <Minus className="size-4" />
                    Stable across reviews
                  </span>
                )}
                {rubricSummary.overallTrend === "baseline" && (
                  <span className="flex items-center gap-1 text-sm font-medium text-teal-300">
                    <Sparkles className="size-4" />
                    Initial baseline evaluation
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Continuous Visual Scale Gauge */}
          <div className="mt-5 space-y-1.5">
            <div className="flex justify-between text-[11px] font-medium text-slate-400">
              <span className="text-rose-400">Needs attention (&lt;50)</span>
              <span className="text-amber-400">Developing (50-74)</span>
              <span className="text-teal-400">Proficient (75-89)</span>
              <span className="text-emerald-400">Exemplary (90-100)</span>
            </div>

            <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-800 p-0.5 border border-slate-700">
              <div className="grid h-full w-full grid-cols-4 gap-0.5 rounded-full overflow-hidden opacity-30">
                <div className="bg-rose-500" />
                <div className="bg-amber-500" />
                <div className="bg-teal-500" />
                <div className="bg-emerald-500" />
              </div>

              {/* Dynamic Score Indicator Needle */}
              <div
                className="absolute top-0 bottom-0 w-2.5 rounded-full bg-white shadow-lg ring-2 ring-teal-400 transition-all duration-500 ease-out -translate-x-1/2"
                style={{
                  left: `${Math.max(4, Math.min(96, rubricSummary.overallScore))}%`,
                }}
              />
            </div>

            <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
              <span>0 pts</span>
              <span className="font-semibold text-white">
                Current: {rubricSummary.overallScore} pts (
                {rubricSummary.overallScaleLabel})
              </span>
              <span>100 pts</span>
            </div>
          </div>

          {/* Breakdown counts */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-white/5 p-2 text-center">
              <p className="text-[10px] text-emerald-400 font-semibold">
                Exemplary
              </p>
              <p className="text-base font-bold text-white">
                {rubricSummary.counts.exemplary}
              </p>
            </div>
            <div className="rounded-lg bg-white/5 p-2 text-center">
              <p className="text-[10px] text-teal-400 font-semibold">
                Proficient
              </p>
              <p className="text-base font-bold text-white">
                {rubricSummary.counts.proficient}
              </p>
            </div>
            <div className="rounded-lg bg-white/5 p-2 text-center">
              <p className="text-[10px] text-amber-400 font-semibold">
                Developing
              </p>
              <p className="text-base font-bold text-white">
                {rubricSummary.counts.developing}
              </p>
            </div>
            <div className="rounded-lg bg-white/5 p-2 text-center">
              <p className="text-[10px] text-rose-400 font-semibold">
                Needs attention
              </p>
              <p className="text-base font-bold text-white">
                {rubricSummary.counts.at_risk}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                filter === "all"
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}
            >
              All ({rubricSummary.criteria.length})
            </button>
            {rubricSummary.counts.at_risk > 0 && (
              <button
                type="button"
                onClick={() => setFilter("at_risk")}
                className={cn(
                  "flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  filter === "at_risk"
                    ? "bg-rose-600 text-white"
                    : "bg-rose-50 text-rose-700 hover:bg-rose-100",
                )}
              >
                Needs Attention ({rubricSummary.counts.at_risk})
              </button>
            )}
            {rubricSummary.counts.developing > 0 && (
              <button
                type="button"
                onClick={() => setFilter("developing")}
                className={cn(
                  "flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  filter === "developing"
                    ? "bg-amber-600 text-white"
                    : "bg-amber-50 text-amber-800 hover:bg-amber-100",
                )}
              >
                Developing ({rubricSummary.counts.developing})
              </button>
            )}
            <button
              type="button"
              onClick={() => setFilter("proficient")}
              className={cn(
                "flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                filter === "proficient"
                  ? "bg-teal-700 text-white"
                  : "bg-teal-50 text-teal-800 hover:bg-teal-100",
              )}
            >
              Proficient / Exemplary (
              {rubricSummary.counts.proficient + rubricSummary.counts.exemplary}
              )
            </button>
            {rubricSummary.counts.improving > 0 && (
              <button
                type="button"
                onClick={() => setFilter("better")}
                className={cn(
                  "flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  filter === "better"
                    ? "bg-emerald-600 text-white"
                    : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
                )}
              >
                <TrendingUp className="size-3" />
                Improving ({rubricSummary.counts.improving})
              </button>
            )}
          </div>
        </div>

        {/* Search input */}
        <div className="relative">
          <label htmlFor={searchInputId} className="sr-only">
            Search rubric criteria
          </label>
          <Search className="absolute left-3 top-2.5 size-4 text-slate-400" />
          <input
            id={searchInputId}
            type="text"
            placeholder="Search rubric criteria..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100"
          />
        </div>
      </div>

      {/* Criteria Breakdown List */}
      <div className="space-y-4">
        {filteredCriteria.length ? (
          filteredCriteria.map((item) => (
            <CriterionProgressCard key={item.id} criterion={item} />
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
            <p className="text-sm font-medium text-slate-600">
              No criteria matched your filter.
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilter("all");
                setSearchQuery("");
              }}
              className="mt-2 text-teal-700"
            >
              Reset filters
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function CriterionProgressCard({
  criterion,
}: {
  criterion: CriterionProgress;
}) {
  const [isExpanded, setIsExpanded] = useState(
    criterion.scaleLevel === "at_risk",
  );
  const [manualRating, setManualRating] = useState<ScaleLevel | null>(null);

  const activeLevel = manualRating ?? criterion.scaleLevel;

  return (
    <article
      className={cn(
        "rounded-2xl border transition-all duration-200 bg-white p-4 shadow-2xs",
        activeLevel === "at_risk" && "border-rose-200 hover:border-rose-300",
        activeLevel === "developing" &&
          "border-amber-200 hover:border-amber-300",
        activeLevel === "proficient" && "border-teal-200 hover:border-teal-300",
        activeLevel === "exemplary" &&
          "border-emerald-200 hover:border-emerald-300",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                activeLevel === "exemplary" &&
                  "bg-emerald-100 text-emerald-800",
                activeLevel === "proficient" && "bg-teal-100 text-teal-800",
                activeLevel === "developing" && "bg-amber-100 text-amber-800",
                activeLevel === "at_risk" && "bg-rose-100 text-rose-800",
              )}
            >
              {activeLevel === "exemplary" && "Exemplary"}
              {activeLevel === "proficient" && "Proficient"}
              {activeLevel === "developing" && "Developing"}
              {activeLevel === "at_risk" && "Needs Attention"}
            </span>

            {criterion.trend === "better" && (
              <span className="flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                <ArrowUpRight className="size-3" />
                Better on scale
                {criterion.delta !== null && ` (+${criterion.delta}%)`}
              </span>
            )}
            {criterion.trend === "regressed" && (
              <span className="flex items-center gap-0.5 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200">
                <ArrowDownRight className="size-3" />
                Regressed
                {criterion.delta !== null && ` (${criterion.delta}%)`}
              </span>
            )}

            {criterion.weight !== null && (
              <span className="ml-auto text-xs font-bold text-teal-700">
                {criterion.weight}%
              </span>
            )}
          </div>

          <h3 className="mt-2 text-sm font-semibold text-slate-900">
            {criterion.title}
          </h3>

          <p className="mt-1 text-xs leading-5 text-slate-600">
            {criterion.description}
          </p>
        </div>
      </div>

      {/* Progress Scale Bar for this criterion */}
      <div className="mt-3.5 space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-medium text-slate-500">
            Criterion score:{" "}
            <strong className="text-slate-900">
              {criterion.currentScore}/100
            </strong>
          </span>
          {criterion.previousScore !== null && (
            <span className="text-slate-400 text-[10px]">
              Previous: {criterion.previousScore}/100
            </span>
          )}
        </div>

        <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              activeLevel === "exemplary" && "bg-emerald-500",
              activeLevel === "proficient" && "bg-teal-500",
              activeLevel === "developing" && "bg-amber-500",
              activeLevel === "at_risk" && "bg-rose-500",
            )}
            style={{ width: `${Math.max(5, criterion.currentScore)}%` }}
          />
        </div>
      </div>

      {/* Findings preview / warnings */}
      {criterion.findings.length > 0 && (
        <div className="mt-3.5 space-y-2">
          {criterion.findings.slice(0, 2).map((finding) => (
            <div
              key={finding.id}
              className={cn(
                "rounded-xl border p-2.5 text-xs leading-5",
                finding.resolution === "resolved"
                  ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                  : finding.severity === "critical"
                    ? "border-rose-200 bg-rose-50/70 text-rose-900"
                    : "border-amber-200 bg-amber-50/70 text-amber-900",
              )}
            >
              <div className="flex items-start gap-1.5 font-semibold">
                {finding.resolution === "resolved" ? (
                  <Check className="mt-0.5 size-3.5 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      finding.severity === "critical"
                        ? "text-rose-600"
                        : "text-amber-600",
                    )}
                  />
                )}
                <span>
                  {finding.resolution === "resolved"
                    ? `Resolved: ${finding.title}`
                    : `${finding.severity.toUpperCase()}: ${finding.title}`}
                </span>
              </div>
              <p className="mt-1 text-[11px] opacity-90 pl-5">
                Fix: {finding.recommendedCorrection}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Interactive Self-Assessment and Details Toggle */}
      <div className="mt-3.5 flex items-center justify-between border-t border-slate-100 pt-3">
        <div className="flex items-center gap-1 text-[10px] text-slate-500">
          <span className="font-semibold uppercase tracking-wider">
            Scale band:
          </span>
          <div className="flex items-center gap-1">
            {(
              [
                "at_risk",
                "developing",
                "proficient",
                "exemplary",
              ] as ScaleLevel[]
            ).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() =>
                  setManualRating(lvl === manualRating ? null : lvl)
                }
                title={`Set manual target / self-assessment: ${lvl}`}
                className={cn(
                  "rounded px-1.5 py-0.5 font-medium transition-all",
                  activeLevel === lvl
                    ? "bg-slate-900 text-white font-bold"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {lvl === "at_risk"
                  ? "At Risk"
                  : lvl === "developing"
                    ? "Developing"
                    : lvl === "proficient"
                      ? "Proficient"
                      : "Exemplary"}
              </button>
            ))}
          </div>
        </div>

        {criterion.findings.length > 2 && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
          >
            {isExpanded ? (
              <>
                Less <ChevronUp className="size-3" />
              </>
            ) : (
              <>
                +{criterion.findings.length - 2} more findings{" "}
                <ChevronDown className="size-3" />
              </>
            )}
          </button>
        )}
      </div>

      {isExpanded && criterion.findings.length > 2 && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {criterion.findings.slice(2).map((finding) => (
            <div
              key={finding.id}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 text-xs text-slate-700"
            >
              <p className="font-semibold">{finding.title}</p>
              <p className="mt-1 text-[11px] text-slate-600">
                Fix: {finding.recommendedCorrection}
              </p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/* ========================================================================= */
/* 2. AGENT ACTIVITY DRAWER CONTENT                                          */
/* ========================================================================= */

function AgentActivityDrawerContent({
  events,
}: {
  events: Array<{
    id: string;
    eventType: string;
    message: string;
    createdAt: Date | string;
  }>;
}) {
  const [filterType, setFilterType] = useState<
    "all" | "review" | "research" | "draft"
  >("all");

  const filteredEvents = useMemo(() => {
    if (filterType === "all") return events;
    return events.filter(
      (e) =>
        e.eventType.toLowerCase().includes(filterType) ||
        e.message.toLowerCase().includes(filterType),
    );
  }, [events, filterType]);

  return (
    <div className="space-y-5">
      {/* Agent status overview */}
      <div className="grid grid-cols-3 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
        <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center shadow-2xs">
          <p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">
            Agent A
          </p>
          <p className="text-xs font-semibold text-slate-800">Reviewer</p>
          <p className="mt-0.5 text-[10px] text-slate-500">Advisory gates</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center shadow-2xs">
          <p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">
            Agent B
          </p>
          <p className="text-xs font-semibold text-slate-800">Writer</p>
          <p className="mt-0.5 text-[10px] text-slate-500">Draft & revise</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-center shadow-2xs">
          <p className="text-[10px] font-bold uppercase tracking-wider text-teal-700">
            Agent C
          </p>
          <p className="text-xs font-semibold text-slate-800">Researcher</p>
          <p className="mt-0.5 text-[10px] text-slate-500">Course & papers</p>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setFilterType("all")}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
            filterType === "all"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200",
          )}
        >
          All events ({events.length})
        </button>
        <button
          type="button"
          onClick={() => setFilterType("review")}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
            filterType === "review"
              ? "bg-teal-700 text-white"
              : "bg-teal-50 text-teal-800 hover:bg-teal-100",
          )}
        >
          Review
        </button>
        <button
          type="button"
          onClick={() => setFilterType("research")}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
            filterType === "research"
              ? "bg-teal-700 text-white"
              : "bg-teal-50 text-teal-800 hover:bg-teal-100",
          )}
        >
          Research
        </button>
        <button
          type="button"
          onClick={() => setFilterType("draft")}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
            filterType === "draft"
              ? "bg-teal-700 text-white"
              : "bg-teal-50 text-teal-800 hover:bg-teal-100",
          )}
        >
          Drafting
        </button>
      </div>

      {/* Event Timeline */}
      {filteredEvents.length ? (
        <ol className="relative space-y-4 border-l-2 border-teal-100 pl-4">
          {filteredEvents.map((event) => (
            <li key={event.id} className="relative">
              <span className="absolute -left-[23px] top-1 size-3 rounded-full border-2 border-white bg-teal-500 shadow-xs" />
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
                <p className="text-xs leading-5 text-slate-800 font-medium">
                  {event.message}
                </p>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span className="font-mono text-[10px] uppercase text-teal-700">
                    {event.eventType}
                  </span>
                  <span>{formatTimestamp(event.createdAt)}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
          No agent activity events recorded yet. Run Agent C research, Agent B
          drafting, or Agent A review to generate live activity.
        </div>
      )}
    </div>
  );
}

/* ========================================================================= */
/* 3. ORIGINAL BRIEF DRAWER CONTENT                                          */
/* ========================================================================= */

function OriginalBriefDrawerContent({
  briefMarkdown,
  courseId,
  questions,
}: {
  briefMarkdown: string;
  courseId: string;
  questions: Array<{
    id: string;
    prompt: string;
    wordLimit: number | null;
    position: number;
  }>;
}) {
  return (
    <div className="space-y-6">
      {/* Question overview pill box */}
      {questions.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-600">
            Detected questions ({questions.length})
          </p>
          <div className="mt-2.5 space-y-2">
            {questions.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-2.5 text-xs"
              >
                <span className="font-semibold text-slate-800 truncate">
                  Question {q.position}: {q.prompt}
                </span>
                {q.wordLimit && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                    ~{q.wordLimit} words
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Brief content */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-2xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Full brief markdown
          </h3>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/dashboard/courses/${courseId}/knowledge`}>
              <ExternalLink className="size-3.5" />
              Open course evidence
            </Link>
          </Button>
        </div>

        <div className="mt-4 max-h-[500px] overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-6 text-slate-700">
          {briefMarkdown}
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(timestamp: Date | string) {
  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function RubricSidebarCard({
  criteria,
  hasDraft,
  answers,
  reviewItems,
  previousReviewItems,
  hasReviewReport,
  hasPreviousReviewReport,
}: {
  criteria: Array<{
    id: string;
    title: string;
    description: string;
    weight: number | null;
    position: number;
  }>;
  hasDraft: boolean;
  answers: Array<{
    questionId: string;
    markdown: string;
    confidenceScore?: number;
  }>;
  reviewItems?: Array<{
    id: string;
    rubricCriterionId?: string | null;
    severity: string;
    title: string;
    recommendedCorrection: string;
    resolution: string;
  }>;
  previousReviewItems?: Array<{
    id: string;
    rubricCriterionId?: string | null;
    severity: string;
    title: string;
    recommendedCorrection: string;
    resolution: string;
  }>;
  hasReviewReport?: boolean;
  hasPreviousReviewReport?: boolean;
}) {
  const summary = useMemo(() => {
    return computeRubricScale({
      criteria,
      hasDraft,
      answers,
      reviewItems,
      previousReviewItems,
      hasReviewReport,
      hasPreviousReviewReport,
    });
  }, [
    criteria,
    hasDraft,
    answers,
    reviewItems,
    previousReviewItems,
    hasReviewReport,
    hasPreviousReviewReport,
  ]);

  return (
    <div className="space-y-4">
      {/* Quick scale status header */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-700">
            Performance scale:{" "}
            <strong className="text-teal-700">
              {summary.overallScore}/100
            </strong>
          </span>
          {summary.overallTrend === "better" && (
            <span className="flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              <ArrowUpRight className="size-3" /> Better on scale
            </span>
          )}
          {summary.overallTrend === "regressed" && (
            <span className="flex items-center gap-0.5 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
              <ArrowDownRight className="size-3" /> Regressed
            </span>
          )}
          {summary.overallTrend === "stable" && (
            <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-medium text-slate-700">
              {summary.overallScaleLabel}
            </span>
          )}
          {summary.overallTrend === "baseline" && (
            <span className="rounded-full bg-teal-100/70 px-2 py-0.5 text-[10px] font-medium text-teal-800">
              Baseline
            </span>
          )}
        </div>

        {/* Mini progress bar */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              summary.overallScaleLevel === "exemplary" && "bg-emerald-500",
              summary.overallScaleLevel === "proficient" && "bg-teal-500",
              summary.overallScaleLevel === "developing" && "bg-amber-500",
              summary.overallScaleLevel === "at_risk" && "bg-rose-500",
            )}
            style={{ width: `${Math.max(5, summary.overallScore)}%` }}
          />
        </div>
      </div>

      {/* Criteria list */}
      {summary.criteria.length ? (
        <ol className="space-y-3.5">
          {summary.criteria.map((criterion) => (
            <li key={criterion.id} className="flex gap-2.5">
              {criterion.scaleLevel === "at_risk" ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-500" />
              ) : criterion.scaleLevel === "developing" ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
              ) : (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-600" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">
                    {criterion.title}
                  </p>
                  <div className="flex items-center gap-1 shrink-0">
                    {criterion.weight !== null && (
                      <span className="text-xs font-semibold text-teal-700">
                        {criterion.weight}%
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.2 text-[10px] font-semibold",
                      criterion.scaleLevel === "exemplary" &&
                        "bg-emerald-50 text-emerald-700",
                      criterion.scaleLevel === "proficient" &&
                        "bg-teal-50 text-teal-700",
                      criterion.scaleLevel === "developing" &&
                        "bg-amber-50 text-amber-700",
                      criterion.scaleLevel === "at_risk" &&
                        "bg-rose-50 text-rose-700",
                    )}
                  >
                    {criterion.scaleLabel} ({criterion.currentScore}/100)
                  </span>

                  {criterion.trend === "better" && (
                    <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-0.5">
                      <ArrowUpRight className="size-2.5" /> Better
                    </span>
                  )}
                  {criterion.trend === "regressed" && (
                    <span className="text-[10px] font-bold text-rose-600 flex items-center gap-0.5">
                      <ArrowDownRight className="size-2.5" /> Regressed
                    </span>
                  )}
                </div>

                <p className="mt-1 text-xs leading-5 text-slate-500 line-clamp-2">
                  {criterion.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-500">
          No rubric was supplied. Review the original brief carefully before
          submission.
        </p>
      )}

      {/* Button to open drawer */}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full mt-2"
        onClick={() => openWorkspaceDrawer("rubric")}
      >
        <BookOpenCheck className="size-4 text-teal-600" />
        Open full rubric scale drawer
      </Button>
    </div>
  );
}
