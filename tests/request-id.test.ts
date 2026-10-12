import { describe, expect, it } from "vitest";

import {
  REQUEST_ID_HEADER,
  resolveRequestId,
} from "@/lib/observability/request-id";

describe("request correlation", () => {
  it("preserves a safe upstream request id", () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: "edge-Request_123" });
    expect(resolveRequestId(headers, () => "generated-id")).toBe(
      "edge-Request_123",
    );
  });

  it("replaces missing or unsafe values", () => {
    expect(resolveRequestId(new Headers(), () => "generated-id")).toBe(
      "generated-id",
    );
    const unsafe = new Headers({ [REQUEST_ID_HEADER]: "bad value forged" });
    expect(resolveRequestId(unsafe, () => "generated-id")).toBe("generated-id");
  });
});
