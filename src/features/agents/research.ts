const retrievalStopWords = new Set([
  "address",
  "and",
  "analyse",
  "analyze",
  "apply",
  "discuss",
  "essay",
  "evaluate",
  "explain",
  "for",
  "from",
  "question",
  "that",
  "the",
  "this",
  "using",
  "with",
  "word",
  "words",
  "write",
]);

export function buildResearchQuery(prompt: string) {
  const terms = [
    ...new Set(
      (prompt.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
        (term) => !retrievalStopWords.has(term),
      ),
    ),
  ].slice(0, 10);
  return terms.length
    ? terms.map((term) => `"${term.replaceAll('"', "")}"`).join(" OR ")
    : prompt.trim().slice(0, 240);
}
