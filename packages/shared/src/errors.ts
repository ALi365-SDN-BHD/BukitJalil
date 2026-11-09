import { z } from "zod";

/**
 * Errors the server sends to the UI. The UI translates `code` with `params`; the server never
 * sends user-facing text in a fixed language (plan 10.1).
 */
export const errorCodes = [
  "auth.required",
  "auth.bad_token",
  "request.bad_host",
  "request.bad_origin",
  "request.bad_content_type",
  "request.missing_csrf_header",
  "request.cors_not_allowed",
  "request.invalid_body",
  "request.not_found",
  "server.internal",
] as const;

export const ErrorCode = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  code: ErrorCode,
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type ApiError = z.infer<typeof ApiError>;
