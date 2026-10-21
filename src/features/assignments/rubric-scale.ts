export type ScaleLevel = "exemplary" | "proficient" | "developing" | "at_risk";

export type CriterionFinding = {
  id: string;
  title: string;
  severity: "critical" | "major" | "minor" | "suggestion" | string;
  recommendedCorrection: string;
  resolution: "open" | "accepted" | "rejected" | "resolved" | string;
};

export type CriterionProgress = {
  id: string;
  title: string;
  description: string;
  weight: number | null;
  position: number;
  currentScore: number; // 0 to 100
  previousScore: number | null; // 0 to 100 or null
  delta: number | null; // currentScore - previousScore
  trend: "better" | "regressed" | "stable" | "baseline";
  scaleLevel: ScaleLevel;
  scaleLabel: string;
  openFindingsCount: number;
  resolvedFindingsCount: number;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
  findings: CriterionFinding[];
};

export type RubricScaleSummary = {
  overallScore: number; // 0 to 100
  previousOverallScore: number | null;
  overallDelta: number | null;
  overallTrend: "better" | "regressed" | "stable" | "baseline";
  overallScaleLevel: ScaleLevel;
  overallScaleLabel: string;
  hasDraft: boolean;
  hasReview: boolean;
  counts: {
    total: number;
    exemplary: number;
    proficient: number;
    developing: number;
    at_risk: number;
    improving: number;
    regressed: number;
    stable: number;
  };
  criteria: CriterionProgress[];
};

export type ComputeRubricScaleInput = {
  criteria: Array<{
    id: string;
    title: string;
    description: string;
    weight: number | null;
    position: number;
  }>;
  hasDraft: boolean;
  answers: Array<{
    id?: string;
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
};

export function getScaleLevel(score: number): {
  level: ScaleLevel;
  label: string;
} {
  if (score >= 90) return { level: "exemplary", label: "Exemplary" };
  if (score >= 75) return { level: "proficient", label: "Proficient" };
  if (score >= 50) return { level: "developing", label: "Developing" };
  return { level: "at_risk", label: "Needs Attention" };
}

export function computeRubricScale(
  input: ComputeRubricScaleInput,
): RubricScaleSummary {
  const {
    criteria,
    hasDraft,
    answers,
    reviewItems = [],
    previousReviewItems = [],
    hasReviewReport = reviewItems.length > 0,
    hasPreviousReviewReport = previousReviewItems.length > 0,
  } = input;

  if (criteria.length === 0) {
    return {
      overallScore: 100,
      previousOverallScore: null,
      overallDelta: null,
      overallTrend: "baseline",
      overallScaleLevel: "exemplary",
      overallScaleLabel: "Exemplary",
      hasDraft,
      hasReview: hasReviewReport,
      counts: {
        total: 0,
        exemplary: 0,
        proficient: 0,
        developing: 0,
        at_risk: 0,
        improving: 0,
        regressed: 0,
        stable: 0,
      },
      criteria: [],
    };
  }

  const answeredCount = answers.filter(
    (a) => a.markdown.trim().length > 0,
  ).length;
  const draftCompletenessRatio =
    answers.length > 0 ? answeredCount / answers.length : 0;

  // Build criterion progress items
  const criterionProgressList: CriterionProgress[] = criteria.map(
    (criterion) => {
      // Match findings for this criterion: by rubricCriterionId or title matching
      const matchingFindings = reviewItems.filter((item) => {
        if (item.rubricCriterionId === criterion.id) return true;
        if (!item.rubricCriterionId) {
          const itemText = (
            item.title +
            " " +
            item.recommendedCorrection
          ).toLowerCase();
          const critWords = criterion.title
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 3);
          if (critWords.some((word) => itemText.includes(word))) return true;
        }
        return false;
      });

      const matchingPrevFindings = previousReviewItems.filter((item) => {
        if (item.rubricCriterionId === criterion.id) return true;
        if (!item.rubricCriterionId) {
          const itemText = (
            item.title +
            " " +
            item.recommendedCorrection
          ).toLowerCase();
          const critWords = criterion.title
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length > 3);
          if (critWords.some((word) => itemText.includes(word))) return true;
        }
        return false;
      });

      const openFindings = matchingFindings.filter(
        (f) => f.resolution !== "resolved",
      );
      const resolvedFindings = matchingFindings.filter(
        (f) => f.resolution === "resolved",
      );

      const criticalCount = openFindings.filter(
        (f) => f.severity === "critical",
      ).length;
      const majorCount = openFindings.filter(
        (f) => f.severity === "major",
      ).length;
      const minorCount = openFindings.filter(
        (f) => f.severity === "minor",
      ).length;

      // Calculate score on 0 - 100 scale
      let currentScore: number;
      if (!hasDraft) {
        currentScore = 0;
      } else if (!hasReviewReport) {
        // Baseline draft before review: estimate based on draft completeness
        currentScore = Math.round(50 + draftCompletenessRatio * 35);
      } else {
        // Reviewed: start at 95 if no issues, deduct for findings
        let penalty = criticalCount * 35 + majorCount * 20 + minorCount * 8;
        const suggestions = openFindings.filter(
          (f) => f.severity === "suggestion",
        ).length;
        penalty += suggestions * 3;

        let base = 95 - penalty;
        // Bonus for resolved issues
        if (resolvedFindings.length > 0) {
          base += Math.min(resolvedFindings.length * 5, 10);
        }
        currentScore = Math.max(10, Math.min(100, Math.round(base)));
      }

      // Calculate previous score if previous review exists
      let previousScore: number | null = null;
      if (hasPreviousReviewReport) {
        const prevOpen = matchingPrevFindings.filter(
          (f) => f.resolution !== "resolved",
        );
        const prevCrit = prevOpen.filter(
          (f) => f.severity === "critical",
        ).length;
        const prevMajor = prevOpen.filter((f) => f.severity === "major").length;
        const prevMinor = prevOpen.filter((f) => f.severity === "minor").length;
        const prevPenalty = prevCrit * 35 + prevMajor * 20 + prevMinor * 8;
        const prevBase = 95 - prevPenalty;
        previousScore = Math.max(10, Math.min(100, Math.round(prevBase)));
      }

      // Determine trend and delta
      let delta: number | null = null;
      let trend: "better" | "regressed" | "stable" | "baseline" = "baseline";

      if (previousScore !== null) {
        delta = currentScore - previousScore;
        if (delta > 0) trend = "better";
        else if (delta < 0) trend = "regressed";
        else trend = "stable";
      } else if (resolvedFindings.length > 0 && openFindings.length === 0) {
        delta = 15;
        trend = "better";
      } else if (hasReviewReport) {
        trend = "stable";
      }

      const { level: scaleLevel, label: scaleLabel } =
        getScaleLevel(currentScore);

      return {
        id: criterion.id,
        title: criterion.title,
        description: criterion.description,
        weight: criterion.weight,
        position: criterion.position,
        currentScore,
        previousScore,
        delta,
        trend,
        scaleLevel,
        scaleLabel,
        openFindingsCount: openFindings.length,
        resolvedFindingsCount: resolvedFindings.length,
        criticalCount,
        majorCount,
        minorCount,
        findings: matchingFindings.map((f) => ({
          id: f.id,
          title: f.title,
          severity: f.severity,
          recommendedCorrection: f.recommendedCorrection,
          resolution: f.resolution,
        })),
      };
    },
  );

  // Calculate weighted overall score
  const totalWeight = criteria.reduce((sum, c) => sum + (c.weight ?? 0), 0);
  let overallScore: number;

  if (totalWeight > 0) {
    const weightedSum = criterionProgressList.reduce(
      (sum, cp) => sum + cp.currentScore * ((cp.weight ?? 0) / totalWeight),
      0,
    );
    overallScore = Math.round(weightedSum);
  } else {
    const simpleAvg =
      criterionProgressList.reduce((sum, cp) => sum + cp.currentScore, 0) /
      criterionProgressList.length;
    overallScore = Math.round(simpleAvg);
  }

  // Calculate previous overall score if available
  let previousOverallScore: number | null = null;
  if (hasPreviousReviewReport) {
    if (totalWeight > 0) {
      const prevWeightedSum = criterionProgressList.reduce((sum, cp) => {
        const prev = cp.previousScore ?? cp.currentScore;
        return sum + prev * ((cp.weight ?? 0) / totalWeight);
      }, 0);
      previousOverallScore = Math.round(prevWeightedSum);
    } else {
      const prevAvg =
        criterionProgressList.reduce(
          (sum, cp) => sum + (cp.previousScore ?? cp.currentScore),
          0,
        ) / criterionProgressList.length;
      previousOverallScore = Math.round(prevAvg);
    }
  }

  let overallDelta: number | null = null;
  let overallTrend: "better" | "regressed" | "stable" | "baseline" = "baseline";

  if (previousOverallScore !== null) {
    overallDelta = overallScore - previousOverallScore;
    if (overallDelta > 0) overallTrend = "better";
    else if (overallDelta < 0) overallTrend = "regressed";
    else overallTrend = "stable";
  } else {
    const hasAnyImproving = criterionProgressList.some(
      (c) => c.trend === "better",
    );
    const hasAnyRegressed = criterionProgressList.some(
      (c) => c.trend === "regressed",
    );
    if (hasAnyImproving && !hasAnyRegressed) {
      overallTrend = "better";
      overallDelta = 10;
    } else if (hasAnyRegressed) {
      overallTrend = "regressed";
      overallDelta = -10;
    } else if (hasReviewReport) {
      overallTrend = "stable";
    }
  }

  const { level: overallScaleLevel, label: overallScaleLabel } =
    getScaleLevel(overallScore);

  const counts = {
    total: criteria.length,
    exemplary: criterionProgressList.filter((c) => c.scaleLevel === "exemplary")
      .length,
    proficient: criterionProgressList.filter(
      (c) => c.scaleLevel === "proficient",
    ).length,
    developing: criterionProgressList.filter(
      (c) => c.scaleLevel === "developing",
    ).length,
    at_risk: criterionProgressList.filter((c) => c.scaleLevel === "at_risk")
      .length,
    improving: criterionProgressList.filter((c) => c.trend === "better").length,
    regressed: criterionProgressList.filter((c) => c.trend === "regressed")
      .length,
    stable: criterionProgressList.filter((c) => c.trend === "stable").length,
  };

  return {
    overallScore,
    previousOverallScore,
    overallDelta,
    overallTrend,
    overallScaleLevel,
    overallScaleLabel,
    hasDraft,
    hasReview: hasReviewReport,
    counts,
    criteria: criterionProgressList,
  };
}
