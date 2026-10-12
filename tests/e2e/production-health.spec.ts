import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const readinessSecret = process.env.JOB_WORKER_SECRET;
if (!readinessSecret || readinessSecret.length < 32) {
  throw new Error("JOB_WORKER_SECRET must contain at least 32 characters.");
}

test("exposes hardened liveness and authenticated readiness responses", async ({
  request,
}) => {
  const requestId = `health-${randomUUID()}`;
  const live = await request.get("/api/health/live", {
    headers: { "x-request-id": requestId },
  });
  expect(live.status()).toBe(200);
  const liveHeaders = live.headers();
  expect(liveHeaders["x-request-id"]).toBe(requestId);
  expect(liveHeaders["cache-control"]).toBe("no-store");
  expect(liveHeaders["x-content-type-options"]).toBe("nosniff");
  expect(liveHeaders["x-frame-options"]).toBe("DENY");
  expect(liveHeaders["content-security-policy"]).toMatch(
    /frame-ancestors 'none'/,
  );
  expect(liveHeaders["strict-transport-security"]).toMatch(/max-age=63072000/);
  expect(await live.json()).toEqual({
    status: "ok",
    service: "scholarflow-ai",
  });

  const denied = await request.get("/api/health/ready");
  expect(denied.status()).toBe(401);
  expect(await denied.json()).toEqual({ status: "unauthorized" });

  const ready = await request.get("/api/health/ready", {
    headers: { authorization: `Bearer ${readinessSecret}` },
  });
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({
    status: "ready",
    database: "reachable",
  });
});
