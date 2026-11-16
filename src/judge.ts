import type { Goal, JudgeState } from "./types.js";

/**
 * The single source of truth for goal semantics.
 * Exact cursor equality for `move-to-target`; exact line-array equality for
 * `edit-to-match`. Malformed input returns `false`; this never throws.
 */
export function isGoalSatisfied(goal: Goal, state: JudgeState): boolean {
  try {
    if (typeof goal !== "object" || goal === null) {
      return false;
    }
    if (typeof state !== "object" || state === null) {
      return false;
    }

    if (goal.kind === "cursor") {
      const target = goal.cursor;
      const cursor = state.cursor;
      return (
        isPosition(target) &&
        isPosition(cursor) &&
        target.line === cursor.line &&
        target.col === cursor.col
      );
    }

    if (goal.kind === "buffer") {
      const target = goal.buffer;
      const buffer = state.buffer;
      if (!Array.isArray(target) || !Array.isArray(buffer)) {
        return false;
      }
      if (target.length !== buffer.length) {
        return false;
      }
      for (let i = 0; i < target.length; i++) {
        const line = target[i];
        if (typeof line !== "string" || line !== buffer[i]) {
          return false;
        }
      }
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function isPosition(value: unknown): value is { line: number; col: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const position = value as { line?: unknown; col?: unknown };
  return (
    typeof position.line === "number" &&
    Number.isInteger(position.line) &&
    position.line >= 0 &&
    typeof position.col === "number" &&
    Number.isInteger(position.col) &&
    position.col >= 0
  );
}
