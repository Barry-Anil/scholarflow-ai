import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "11111111-1111-4111-8111-111111111111" };
const assignmentId = "22222222-2222-4222-8222-222222222222";
const draftId = "33333333-3333-4333-8333-333333333333";

const getOptionalUser = vi.fn();
const getAssignmentMonitor = vi.fn();
const getAssignmentEvents = vi.fn();
const getProvenanceIndex = vi.fn();
const getDraftProvenance = vi.fn();
const getRubricTrace = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getOptionalUser }));
vi.mock("@/features/monitoring/data", async () => {
  const { z } = await import("zod");
  return {
    getAssignmentMonitor,
    getAssignmentEvents,
    eventQuerySchema: z.object({
      cursor: z.string().optional(),
      agent: z.enum(["researcher", "student", "reviewer"]).optional(),
      severity: z.enum(["info", "success", "warning", "failure"]).optional(),
      sinceHours: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(40),
    }),
  };
});
vi.mock("@/features/monitoring/provenance", () => ({
  getProvenanceIndex,
  getDraftProvenance,
  getRubricTrace,
}));

const monitorRoute =
  await import("@/app/api/assignments/[assignmentId]/monitor/route");
const eventsRoute =
  await import("@/app/api/assignments/[assignmentId]/monitor/events/route");
const provenanceRoute =
  await import("@/app/api/assignments/[assignmentId]/provenance/route");
const { AppError } = await import("@/lib/errors");

const params = (id = assignmentId) => ({
  params: Promise.resolve({ assignmentId: id }),
});
const request = (path: string) => new Request(`http://localhost${path}`);

beforeEach(() => {
  vi.clearAllMocks();
  getOptionalUser.mockResolvedValue(user);
});

describe("monitoring routes", () => {
  it("expose only read-only GET handlers", () => {
    for (const route of [monitorRoute, eventsRoute, provenanceRoute]) {
      expect(Object.keys(route)).toEqual(["GET"]);
    }
  });

  it("require a signed-in user", async () => {
    getOptionalUser.mockResolvedValue(null);
    const responses = await Promise.all([
      monitorRoute.GET(request("/monitor"), params()),
      eventsRoute.GET(request("/events"), params()),
      provenanceRoute.GET(request("/provenance"), params()),
    ]);
    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401,
    ]);
    expect(getAssignmentMonitor).not.toHaveBeenCalled();
  });

  it("validate identifiers and filters before querying", async () => {
    expect(
      (await monitorRoute.GET(request("/monitor"), params("nope"))).status,
    ).toBe(400);
    expect(
      (await eventsRoute.GET(request("/events?severity=critical"), params()))
        .status,
    ).toBe(400);
    expect(
      (
        await provenanceRoute.GET(
          request(`/provenance?draftId=${draftId}&reportId=${draftId}`),
          params(),
        )
      ).status,
    ).toBe(400);
    expect(getAssignmentEvents).not.toHaveBeenCalled();
    expect(getDraftProvenance).not.toHaveBeenCalled();
  });

  it("checks access for the signed-in user and preserves denial status", async () => {
    getAssignmentMonitor.mockRejectedValue(
      new AppError("FORBIDDEN", "You cannot access this course.", {
        status: 403,
      }),
    );
    const response = await monitorRoute.GET(request("/monitor"), params());
    expect(response.status).toBe(403);
    expect(getAssignmentMonitor).toHaveBeenCalledWith(assignmentId, user.id);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("routes provenance queries to the matching reader", async () => {
    getDraftProvenance.mockResolvedValue({ draft: { id: draftId } });
    const response = await provenanceRoute.GET(
      request(`/provenance?draftId=${draftId}`),
      params(),
    );
    expect(response.status).toBe(200);
    expect(getDraftProvenance).toHaveBeenCalledWith(
      assignmentId,
      user.id,
      draftId,
    );
    expect(getProvenanceIndex).not.toHaveBeenCalled();
  });

  it("passes parsed event filters through", async () => {
    getAssignmentEvents.mockResolvedValue({ events: [], nextCursor: null });
    const response = await eventsRoute.GET(
      request("/events?agent=reviewer&severity=failure&sinceHours=24"),
      params(),
    );
    expect(response.status).toBe(200);
    expect(getAssignmentEvents).toHaveBeenCalledWith(
      assignmentId,
      user.id,
      expect.objectContaining({
        agent: "reviewer",
        severity: "failure",
        sinceHours: 24,
      }),
    );
  });
});
