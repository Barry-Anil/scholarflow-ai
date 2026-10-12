export const REQUEST_ID_HEADER = "x-request-id";

const validRequestId = /^[a-zA-Z0-9._-]{8,128}$/;

export function resolveRequestId(
  headers: Headers,
  create = () => crypto.randomUUID(),
) {
  const supplied = headers.get(REQUEST_ID_HEADER);
  return supplied && validRequestId.test(supplied) ? supplied : create();
}

export function requestLogContext(request: Request) {
  return { requestId: resolveRequestId(request.headers) };
}
