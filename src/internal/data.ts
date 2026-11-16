/**
 * Compiled runtime data shapes.
 *
 * These describe the artifact emitted by `scripts/codegen.ts`. They are
 * internal: only `src/generated/runtime.ts` and the generator/API touch them.
 * Reference solutions are never part of this shape.
 */

export type ChallengeType = "move-to-target" | "edit-to-match";

export interface CompiledGroup {
  id: string;
  title: string;
  description: string;
  order: number;
}

export interface CompiledSkill {
  id: string;
  title: string;
  group: string;
  order: number;
  summary: string;
  description: string;
  prerequisites: string[];
  tags: string[];
}

export interface CompiledLesson {
  id: string;
  slug: string;
  title: string;
  group: string;
  order: number;
  difficulty: number;
  skills: string[];
  summary: string;
  instructions: string;
  hints: string[];
  keyLegend: string[];
  tags: string[];
}

/** A resolved cursor reference into a line fact and one of its named spans. */
export interface SpanRef {
  fact: string;
  span: string;
}

export interface CompiledCursor {
  line: number;
  /** Literal column. Exactly one of `col`/`at` is present. */
  col?: number;
  /** Span reference. Exactly one of `col`/`at` is present. */
  at?: SpanRef;
  edge: "start" | "last";
  offset: number;
}

export type BufferRef = { ref: string } | { lit: string[] };

export type CompiledPart =
  | { kind: "text"; text: string; as?: string }
  | { kind: "pick"; name: string; index: number; as?: string }
  | { kind: "line"; name: string; as?: string };

export type CompiledOp =
  | {
      op: "pick";
      name: string;
      /** Pool items after build-time constraint filtering, in source order. */
      items: string[];
      count: number;
      unique: boolean;
    }
  | { op: "line"; name: string; parts: CompiledPart[] }
  | {
      op: "buffer";
      name: string;
      lines: Array<{ kind: "line"; name: string } | { kind: "text"; text: string }>;
    };

export type CompiledGoal =
  | { kind: "cursor"; cursor: CompiledCursor }
  | { kind: "buffer"; buffer: BufferRef };

export interface CompiledTemplate {
  id: string;
  lessonId: string;
  lessonSlug: string;
  order: number;
  type: ChallengeType;
  allowedKeys: string[];
  par: number;
  ops: CompiledOp[];
  initial: { buffer: BufferRef; cursor: CompiledCursor };
  goal: CompiledGoal;
}

export interface CompiledRuntime {
  contentVersion: string;
  schemaVersion: number;
  generatorVersion: number;
  groups: CompiledGroup[];
  skills: CompiledSkill[];
  lessons: CompiledLesson[];
  templates: CompiledTemplate[];
}

/** Engine compatibility metadata. Excluded from the runtime build hash. */
export interface CompiledCompatibility {
  engineRange: string;
  tested: string[];
}
