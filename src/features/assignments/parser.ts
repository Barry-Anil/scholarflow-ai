export type ParsedQuestion = {
  prompt: string;
  requirements: string[];
  wordLimit: number | null;
};

export type ParsedCriterion = {
  title: string;
  description: string;
  weight: number | null;
};

const questionPattern =
  /^\s*(?:(?:question|q)\s*)?(\d{1,3})\s*[.):\-]\s*(.+)$/i;
const bulletPattern = /^\s*[-*•]\s+(.+)$/;
const wordLimitPattern = /\b([\d,]{2,})\s*[- ]?words?\b/i;

function cleanLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractWordLimit(value: string) {
  const match = value.match(wordLimitPattern);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1].replaceAll(",", ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseAssignmentQuestions(brief: string): ParsedQuestion[] {
  const lines = brief.split(/\r?\n/);
  const questions: ParsedQuestion[] = [];
  let current: ParsedQuestion | undefined;

  for (const rawLine of lines) {
    const line = cleanLine(rawLine);
    if (!line) continue;
    const numbered = line.match(questionPattern);
    if (numbered?.[2]) {
      current = {
        prompt: cleanLine(numbered[2]),
        requirements: [],
        wordLimit: extractWordLimit(line),
      };
      questions.push(current);
      continue;
    }
    const bullet = line.match(bulletPattern);
    if (bullet?.[1] && current) {
      current.requirements.push(cleanLine(bullet[1]));
      current.wordLimit ??= extractWordLimit(bullet[1]);
    }
  }

  if (questions.length) return questions.slice(0, 50);

  const firstPrompt = lines
    .map(cleanLine)
    .find((line) => line.length >= 12 && !bulletPattern.test(line));
  return [
    {
      prompt: firstPrompt ?? "Respond to the assignment brief.",
      requirements: lines
        .map((line) => cleanLine(line).match(bulletPattern)?.[1])
        .filter((value): value is string => Boolean(value))
        .slice(0, 20),
      wordLimit: extractWordLimit(brief),
    },
  ];
}

export function parseRubricCriteria(rubric: string): ParsedCriterion[] {
  return rubric
    .split(/\r?\n/)
    .map((line) => cleanLine(line).replace(/^[-*•]\s+/, ""))
    .filter(Boolean)
    .slice(0, 50)
    .map((line, index) => {
      const weightMatch = line.match(/(?:\(|\b)(\d{1,3}(?:\.\d+)?)\s*%\)?/);
      const weight = weightMatch?.[1]
        ? Number.parseFloat(weightMatch[1])
        : null;
      const withoutWeight = cleanLine(
        line.replace(/(?:\(|\b)\d{1,3}(?:\.\d+)?\s*%\)?/, ""),
      ).replace(/^[-–—:]+|[-–—:]+$/g, "");
      const separator = withoutWeight.search(/\s(?:[-–—:]|\|)\s/);
      const title = cleanLine(
        separator >= 0 ? withoutWeight.slice(0, separator) : withoutWeight,
      );
      const description = cleanLine(
        separator >= 0 ? withoutWeight.slice(separator + 3) : withoutWeight,
      );
      return {
        title: title || `Criterion ${index + 1}`,
        description: description || title || `Criterion ${index + 1}`,
        weight: weight !== null && weight >= 0 && weight <= 100 ? weight : null,
      };
    });
}

export function countWords(value: string) {
  return value.trim().match(/\S+/g)?.length ?? 0;
}
