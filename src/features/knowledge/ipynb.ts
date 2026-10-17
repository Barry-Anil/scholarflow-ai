import { AppError } from "@/lib/errors";
import { normalizeExtractedText } from "./chunking";

type JupyterCellOutput = {
  output_type?: string;
  text?: string | string[];
  data?: Record<string, unknown>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
};

type JupyterCell = {
  cell_type?: string;
  source?: string | string[];
  execution_count?: number | null;
  outputs?: JupyterCellOutput[];
};

type JupyterNotebook = {
  cells?: JupyterCell[];
  worksheets?: Array<{ cells?: JupyterCell[] }>;
  metadata?: {
    language_info?: {
      name?: string;
    };
  };
  nbformat?: number;
};

function extractSourceText(source: unknown): string {
  if (Array.isArray(source)) {
    return source.map((line) => (typeof line === "string" ? line : "")).join("");
  }
  if (typeof source === "string") {
    return source;
  }
  return "";
}

function stripAnsiEscapes(text: string): string {
  // Strips ANSI terminal escape codes from tracebacks
  return text.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
}

export type ExtractedNotebook = {
  text: string;
  cellCount: number;
  language: string;
};

export function extractIpynbText(bytes: ArrayBuffer): ExtractedNotebook {
  const raw = Buffer.from(bytes).toString("utf8");
  let notebook: JupyterNotebook;

  try {
    notebook = JSON.parse(raw) as JupyterNotebook;
  } catch (error) {
    throw new AppError(
      "INVALID_INPUT",
      "The Jupyter Notebook is not valid JSON.",
      { cause: error },
    );
  }

  if (typeof notebook !== "object" || notebook === null) {
    throw new AppError(
      "INVALID_INPUT",
      "The Jupyter Notebook format is invalid.",
    );
  }

  const cells: JupyterCell[] = Array.isArray(notebook.cells)
    ? notebook.cells
    : Array.isArray(notebook.worksheets)
      ? notebook.worksheets.flatMap((worksheet) =>
          Array.isArray(worksheet.cells) ? worksheet.cells : [],
        )
      : [];

  const rawLanguage = notebook.metadata?.language_info?.name;
  const language =
    typeof rawLanguage === "string" && rawLanguage.trim()
      ? rawLanguage.trim().toLowerCase()
      : "python";

  const sections: string[] = [];

  for (const cell of cells) {
    const cellType = cell.cell_type ?? "code";
    const source = extractSourceText(cell.source).trim();

    if (cellType === "markdown" || cellType === "raw") {
      if (source) {
        sections.push(source);
      }
      continue;
    }

    // Code cell
    const cellParts: string[] = [];
    if (source) {
      cellParts.push(`\`\`\`${language}\n${source}\n\`\`\``);
    }

    if (Array.isArray(cell.outputs) && cell.outputs.length > 0) {
      const outputParts: string[] = [];
      for (const output of cell.outputs) {
        if (output.output_type === "stream" && output.text) {
          const streamText = extractSourceText(output.text).trim();
          if (streamText) outputParts.push(streamText);
        } else if (
          (output.output_type === "execute_result" ||
            output.output_type === "display_data") &&
          output.data &&
          output.data["text/plain"]
        ) {
          const plainText = extractSourceText(output.data["text/plain"]).trim();
          if (plainText) outputParts.push(plainText);
        } else if (output.output_type === "error" && output.traceback) {
          const traceText = stripAnsiEscapes(
            extractSourceText(output.traceback),
          ).trim();
          if (traceText) outputParts.push(traceText);
        }
      }

      const combinedOutputs = outputParts.join("\n").trim();
      if (combinedOutputs) {
        const truncated =
          combinedOutputs.length > 4_000
            ? `${combinedOutputs.slice(0, 4_000)}\n... [output truncated]`
            : combinedOutputs;
        cellParts.push(`Output:\n\`\`\`\n${truncated}\n\`\`\``);
      }
    }

    if (cellParts.length > 0) {
      sections.push(cellParts.join("\n\n"));
    }
  }

  const combined = sections.join("\n\n");
  const text = normalizeExtractedText(combined, { preserveIndentation: true });

  return {
    text,
    cellCount: cells.length,
    language,
  };
}
