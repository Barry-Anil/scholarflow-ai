export type RetrievalCandidate = {
  id: string;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  filename: string;
};

export type ScoredRetrievalCandidate = RetrievalCandidate & { score: number };

export function fuseKnowledgeResults(
  keywordRows: ScoredRetrievalCandidate[],
  semanticRows: ScoredRetrievalCandidate[],
  limit: number,
) {
  const fused = new Map<
    string,
    RetrievalCandidate & {
      rank: number;
      keywordRank: number | null;
      semanticRank: number | null;
      semanticScore: number | null;
    }
  >();
  for (const [index, row] of keywordRows.entries()) {
    fused.set(row.id, {
      ...row,
      rank: 1 / (60 + index + 1),
      keywordRank: index + 1,
      semanticRank: null,
      semanticScore: null,
    });
  }
  for (const [index, row] of semanticRows.entries()) {
    const existing = fused.get(row.id);
    fused.set(row.id, {
      id: row.id,
      content: row.content,
      pageStart: row.pageStart,
      pageEnd: row.pageEnd,
      filename: row.filename,
      rank: (existing?.rank ?? 0) + 1 / (60 + index + 1),
      keywordRank: existing?.keywordRank ?? null,
      semanticRank: index + 1,
      semanticScore: row.score,
    });
  }
  return [...fused.values()]
    .sort((left, right) => right.rank - left.rank)
    .slice(0, Math.max(1, Math.min(limit, 50)));
}
