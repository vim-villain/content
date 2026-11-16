export type ValidationCode =
  | "E_YAML"
  | "E_SCHEMA"
  | "E_ID"
  | "E_REGISTRY"
  | "E_SLUG"
  | "E_REF"
  | "E_CYCLE"
  | "E_ORDER"
  | "E_STATUS"
  | "E_LIMIT"
  | "E_ALLOWED"
  | "E_SOLUTION"
  | "E_PAR"
  | "E_REPLAY"
  | "E_GOAL"
  | "E_DETERMINISM"
  | "E_VERSION"
  | "E_PACK";

export interface ValidationError {
  code: ValidationCode;
  file: string;
  pointer: string;
  message: string;
  hint: string;
}

export class ValidationFailure extends Error {
  readonly errors: readonly ValidationError[];

  constructor(errors: readonly ValidationError[]) {
    super(`${errors.length} validation error(s)`);
    this.name = "ValidationFailure";
    this.errors = errors;
  }
}

export class Collector {
  readonly errors: ValidationError[] = [];

  add(
    code: ValidationCode,
    file: string,
    pointer: string,
    message: string,
    hint: string,
  ): void {
    this.errors.push({ code, file, pointer, message, hint });
  }

  get failed(): boolean {
    return this.errors.length > 0;
  }

  throwIfFailed(): void {
    if (this.errors.length > 0) {
      throw new ValidationFailure(this.errors.slice());
    }
  }
}

export function formatValidationError(error: ValidationError): string {
  return [
    `${error.code} ${error.file}`,
    `  at ${error.pointer}`,
    `  ${error.message}`,
    `  hint: ${error.hint}`,
  ].join("\n");
}
