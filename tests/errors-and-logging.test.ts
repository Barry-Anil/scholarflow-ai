import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError, errorFingerprint, safeErrorMessage } from "@/lib/errors";

describe("safe application errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns actionable messages only for typed errors", () => {
    expect(
      safeErrorMessage(
        new AppError("DATABASE_UNAVAILABLE", "Workspace is unavailable."),
      ),
    ).toBe("Workspace is unavailable.");
    expect(safeErrorMessage(new Error("postgresql://secret-connection"))).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("fingerprints failures without serializing their messages", () => {
    const fingerprint = errorFingerprint(new Error("private document text"));
    expect(fingerprint).toEqual({ errorName: "Error" });
    expect(JSON.stringify(fingerprint)).not.toContain("private document text");
  });
});
