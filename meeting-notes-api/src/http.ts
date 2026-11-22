export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "method_not_allowed"
  | "rate_limited"
  | "upstream_error"
  | "internal_error";

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
} as const;

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return jsonResponse({ error: { code, message } }, status, extraHeaders);
}
