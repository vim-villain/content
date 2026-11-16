export type ContentErrorCode =
  | "UNKNOWN_LESSON"
  | "UNKNOWN_TEMPLATE"
  | "INVALID_SEED"
  | "NO_ACTIVE_TEMPLATE"
  | "GENERATION_FAILED";

export type ContentErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

/**
 * Typed generation/lookup error. Lookups return `null`; generation throws this.
 * Details never contain reference keys, pool contents, or solutions.
 */
export class ContentError extends Error {
  readonly code: ContentErrorCode;
  readonly details: ContentErrorDetails;

  constructor(
    code: ContentErrorCode,
    message: string,
    details: ContentErrorDetails = {},
  ) {
    super(message);
    this.name = "ContentError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const CODES: ReadonlySet<string> = new Set<ContentErrorCode>([
  "UNKNOWN_LESSON",
  "UNKNOWN_TEMPLATE",
  "INVALID_SEED",
  "NO_ACTIVE_TEMPLATE",
  "GENERATION_FAILED",
]);

/**
 * Cross-realm-safe guard. A ContentError constructed in another realm (or a
 * duplicated module instance) fails `instanceof`, so the name/code shape is
 * checked as well.
 */
export function isContentError(error: unknown): error is ContentError {
  if (error instanceof ContentError) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === "ContentError" &&
    typeof candidate.code === "string" &&
    CODES.has(candidate.code)
  );
}
