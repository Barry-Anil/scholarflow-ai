export type OllamaAccessCredentials = {
  clientId: string;
  clientSecret: string;
};

export function createOllamaRequestHeaders(
  credentials?: OllamaAccessCredentials,
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (credentials) {
    headers.set("CF-Access-Client-Id", credentials.clientId);
    headers.set("CF-Access-Client-Secret", credentials.clientSecret);
  }
  return headers;
}
