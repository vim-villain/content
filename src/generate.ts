import { ContentError } from "./errors.js";
import { hash32, mulberry32 } from "./prng.js";
import type { GeneratedInstance, Goal } from "./types.js";
import type { CompiledTemplate } from "./internal/data.js";
import {
  GenerationInvariantError,
  executeTemplate,
  resolveBuffer,
  resolveCursor,
} from "./internal/interpreter.js";
import {
  runtime,
  templateById,
  templatesByLesson,
  lessonBySlug,
} from "./internal/store.js";

const SEED_PATTERN = /^[0-9a-f]{16,64}$/;

function assertSeed(seed: unknown): asserts seed is string {
  if (typeof seed !== "string" || !SEED_PATTERN.test(seed)) {
    throw new ContentError(
      "INVALID_SEED",
      "Seed must be 16 to 64 lowercase hexadecimal characters.",
      { reason: "seed-format" },
    );
  }
}

function freeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => freeze(item))) as T;
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = freeze(item);
    }
    return Object.freeze(result) as T;
  }
  return value;
}

/** Generate an instance for an already-resolved compiled template. */
function generateFor(template: CompiledTemplate, seed: string): GeneratedInstance {
  try {
    const nextUint32 = mulberry32(
      hash32(`generate\0${template.id}\0${seed}`),
    );
    const table = executeTemplate(template, nextUint32);

    const buffer = resolveBuffer(template.initial.buffer, table.facts);
    const cursor = resolveCursor(template.initial.cursor, table.facts, buffer);

    let goal: Goal;
    if (template.goal.kind === "cursor") {
      goal = {
        kind: "cursor",
        cursor: resolveCursor(template.goal.cursor, table.facts, buffer),
      };
    } else {
      goal = {
        kind: "buffer",
        buffer: resolveBuffer(template.goal.buffer, table.facts),
      };
    }

    if (satisfies(goal, buffer, cursor)) {
      throw new GenerationInvariantError(
        "initial state already satisfies the goal",
      );
    }

    const instance: GeneratedInstance = {
      schemaVersion: runtime.schemaVersion,
      contentVersion: runtime.contentVersion,
      lessonId: template.lessonId,
      lessonSlug: template.lessonSlug,
      templateId: template.id,
      challengeType: template.type,
      buffer,
      cursor,
      goal,
      allowedKeys: template.allowedKeys,
      par: template.par,
    };

    return freeze(instance);
  } catch (error) {
    if (error instanceof ContentError) {
      throw error;
    }
    throw new ContentError(
      "GENERATION_FAILED",
      "The compiled template could not produce a valid instance.",
      {
        templateId: template.id,
        seed,
        reason: error instanceof Error ? error.message : "unknown",
      },
    );
  }
}

function satisfies(
  goal: Goal,
  buffer: readonly string[],
  cursor: { line: number; col: number },
): boolean {
  if (goal.kind === "cursor") {
    return goal.cursor.line === cursor.line && goal.cursor.col === cursor.col;
  }
  if (goal.buffer.length !== buffer.length) {
    return false;
  }
  for (let i = 0; i < buffer.length; i++) {
    if (goal.buffer[i] !== buffer[i]) {
      return false;
    }
  }
  return true;
}

/** Generate an instance for an exact template ID. Used by replay/racing. */
export function generateForTemplate(
  template: CompiledTemplate,
  seed: string,
  contentVersion: string,
): GeneratedInstance {
  const instance = generateFor(template, seed);
  return freeze({ ...instance, contentVersion });
}

/** Public generation entry point. */
export function generateInstance(
  templateId: string,
  seed: string,
): GeneratedInstance {
  const template = templateById.get(templateId);
  if (template === undefined) {
    throw new ContentError("UNKNOWN_TEMPLATE", "Unknown template ID.", {
      templateId,
    });
  }
  assertSeed(seed);
  return generateForTemplate(template, seed, runtime.contentVersion);
}

/** Public start entry point. */
export function startLesson(slug: string, seed: string): GeneratedInstance {
  const lesson = lessonBySlug.get(slug);
  if (lesson === undefined) {
    throw new ContentError("UNKNOWN_LESSON", "Unknown lesson slug.", {
      lessonSlug: slug,
    });
  }
  assertSeed(seed);

  const templates = templatesByLesson.get(lesson.id) ?? [];
  if (templates.length === 0) {
    throw new ContentError(
      "NO_ACTIVE_TEMPLATE",
      "The lesson has no active template.",
      { lessonId: lesson.id, lessonSlug: lesson.slug },
    );
  }

  let selected: CompiledTemplate;
  if (templates.length === 1) {
    selected = templates[0] as CompiledTemplate;
  } else {
    const index =
      hash32(`select\0${lesson.id}\0${seed}`) % templates.length;
    selected = templates[index] as CompiledTemplate;
  }

  return generateForTemplate(selected, seed, runtime.contentVersion);
}
