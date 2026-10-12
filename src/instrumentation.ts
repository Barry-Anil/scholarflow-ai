import type { Instrumentation } from "next";

import { errorFingerprint } from "@/lib/errors";
import { logger } from "@/lib/logging/logger";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id";

export function register() {
  logger.info("application.started", {
    runtime: process.env.NEXT_RUNTIME ?? "unknown",
  });
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const requestIdValue = request.headers[REQUEST_ID_HEADER];
  logger.error("server.request_error", {
    requestId: Array.isArray(requestIdValue)
      ? requestIdValue[0]
      : requestIdValue,
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
    ...errorFingerprint(error),
  });
};
