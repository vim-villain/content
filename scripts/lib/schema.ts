import { z } from "zod";

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/;
const ASCII_PROSE = /^[\x20-\x7e\n]*$/;
const ASCII_SINGLE_LINE = /^[\x20-\x7e]+$/;
const KEY_TOKEN =
  /^(?:[\x20-\x7e]|Escape|Enter|Backspace|Delete|Tab|Control-[\x20-\x7e])$/;
const FACT_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const SEGMENT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const SEMVER_RANGE = /^[><=~^0-9x*.\-\s|]+$/;

/** Trim leading/trailing blank lines and normalize line endings. */
export function normalizeProse(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

const prose = (min: number, max: number) =>
  z
    .string()
    .transform(normalizeProse)
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine((value) => ASCII_PROSE.test(value), "must be printable ASCII"),
    );

const asciiLine = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(ASCII_SINGLE_LINE, "must be a single printable ASCII line");

/** Dot-separated lowercase ID segments. Path equality is checked separately. */
export const idSchema = z
  .string()
  .max(120)
  .refine(
    (value) =>
      value.split(".").every((segment) => SEGMENT.test(segment)) &&
      value.split(".").length >= 2,
    "must be dot-separated lowercase kebab segments",
  );

/** Group IDs are a single kebab-case segment, not a dotted content ID. */
export const groupRefSchema = z
  .string()
  .min(2)
  .max(40)
  .regex(SEGMENT, "must be a single lowercase kebab segment");

export const slugSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(SLUG, "must be lowercase kebab-case, 3-40 characters");

export const tokenSchema = z
  .string()
  .regex(KEY_TOKEN, "must be a valid engine key token");

export const factNameSchema = z
  .string()
  .regex(FACT_NAME, "must match [a-z][a-z0-9_]{0,31}");

export const statusSchema = z.enum(["active", "draft", "retired"]);

const orderSchema = z.number().int().min(0).max(9999);

export const groupSchema = z.strictObject({
  id: groupRefSchema,
  title: asciiLine(2, 40),
  description: asciiLine(10, 160),
  order: orderSchema,
});

export const groupsFileSchema = z.array(groupSchema).min(1);

export const skillSchema = z.strictObject({
  id: idSchema,
  title: asciiLine(2, 60),
  group: groupRefSchema,
  order: orderSchema,
  summary: asciiLine(10, 160),
  description: prose(0, 1200).optional(),
  prerequisites: z.array(idSchema).max(16).optional(),
  tags: z.array(slugSchema).max(8).optional(),
  status: statusSchema.optional(),
});

const skillTags = z.array(slugSchema).max(8);

export const lessonSchema = z.strictObject({
  id: idSchema,
  slug: slugSchema,
  title: asciiLine(2, 60),
  group: groupRefSchema,
  order: orderSchema,
  difficulty: z.number().int().min(1).max(5),
  skills: z.array(idSchema).min(1).max(4),
  summary: asciiLine(10, 160),
  instructions: prose(20, 1600).refine(
    (value) => value.split("\n").length <= 20,
    "must be at most 20 lines",
  ),
  hints: z.array(prose(5, 240)).max(5).optional(),
  keyLegend: z.array(tokenSchema).max(16).optional(),
  tags: skillTags.optional(),
  status: statusSchema.optional(),
});

export const lengthConstraintSchema = z.strictObject({
  min: z.number().int().min(0).max(100).optional(),
  max: z.number().int().min(0).max(100).optional(),
});

export const constraintsSchema = z.strictObject({
  length: lengthConstraintSchema.optional(),
  charset: z.enum(["ascii-lower", "ascii-alnum", "ascii"]).optional(),
  forbidChars: z.string().max(100).regex(ASCII_PRINTABLE).optional(),
  requireChars: z.string().max(100).regex(ASCII_PRINTABLE).optional(),
  uniqueChars: z.boolean().optional(),
  notIn: z.array(z.string().max(100).regex(ASCII_PRINTABLE)).max(512).optional(),
});

export const pickOpSchema = z.strictObject({
  op: z.literal("pick"),
  name: factNameSchema,
  pool: idSchema,
  count: z.number().int().min(1).max(8),
  unique: z.boolean().optional(),
  constraints: constraintsSchema.optional(),
});

export const partSchema = z
  .strictObject({
    ref: z.string().max(200).optional(),
    text: z.string().max(100).regex(ASCII_PRINTABLE).optional(),
    as: factNameSchema.optional(),
  })
  .refine(
    (part) => (part.ref === undefined) !== (part.text === undefined),
    "a part must have exactly one of ref or text",
  );

export const lineOpSchema = z.strictObject({
  op: z.literal("line"),
  name: factNameSchema,
  parts: z.array(partSchema).min(1).max(32),
});

export const bufferOpSchema = z.strictObject({
  op: z.literal("buffer"),
  name: factNameSchema,
  lines: z
    .array(
      z
        .strictObject({
          ref: z.string().max(200).optional(),
          text: z.string().max(100).regex(ASCII_PRINTABLE).optional(),
        })
        .refine(
          (line) => (line.ref === undefined) !== (line.text === undefined),
          "a buffer line must have exactly one of ref or text",
        ),
    )
    .min(1)
    .max(12),
});

export const opSchema = z.discriminatedUnion("op", [
  pickOpSchema,
  lineOpSchema,
  bufferOpSchema,
]);

export const bufferRefSchema = z.union([
  z.strictObject({ ref: factNameSchema }),
  z.strictObject({
    lit: z.array(z.string().max(100).regex(ASCII_PRINTABLE)).min(1).max(12),
  }),
]);

export const cursorSpecSchema = z
  .strictObject({
    line: z.number().int().min(0).max(11),
    col: z.number().int().min(0).max(100).optional(),
    at: z.string().max(200).optional(),
    edge: z.enum(["start", "last"]).optional(),
    offset: z.number().int().min(-16).max(16).optional(),
  })
  .refine(
    (spec) => (spec.col === undefined) !== (spec.at === undefined),
    "a cursor must have exactly one of col or at",
  );

export const goalSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("cursor"),
    cursor: cursorSpecSchema,
  }),
  z.strictObject({
    kind: z.literal("buffer"),
    buffer: bufferRefSchema,
  }),
]);

export const allowedSchema = z.union([
  z.strictObject({
    preset: z.string().max(60),
    extra: z.array(tokenSchema).max(64).optional(),
  }),
  z.array(tokenSchema).min(1).max(64),
]);

export const solutionSchema = z.strictObject({
  keys: z.array(tokenSchema).min(1).max(64),
});

export const templateSchema = z.strictObject({
  id: idSchema,
  lesson: idSchema,
  order: orderSchema,
  status: statusSchema.optional(),
  type: z.enum(["move-to-target", "edit-to-match"]),
  engine: z.string().max(80).regex(SEMVER_RANGE, "must be a semver range"),
  title: asciiLine(2, 60),
  description: prose(0, 240).optional(),
  notes: prose(0, 1200).optional(),
  generate: z.array(opSchema).min(1).max(32),
  initial: z.strictObject({
    buffer: bufferRefSchema,
    cursor: cursorSpecSchema,
  }),
  goal: goalSchema,
  allowed: allowedSchema,
  solution: solutionSchema,
  par: z.number().int().min(1).max(64),
});

export const poolSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(["word", "big-word"]),
  items: z
    .array(z.string().min(1).max(20).regex(ASCII_PRINTABLE))
    .min(1)
    .max(512),
});

export const presetEntrySchema = z.strictObject({
  name: z.string().max(60).regex(/^[a-z][a-z0-9.-]*$/),
  keys: z.array(tokenSchema).min(1).max(64),
});

export const presetsFileSchema = z.strictObject({
  presets: z.array(presetEntrySchema).min(1),
});

export const compatibilitySchema = z.strictObject({
  engineRange: z.string().min(1).max(120),
  tested: z.array(z.string().regex(SEMVER, "must be an exact x.y.z version")).min(1),
});

export const registrySchema = z.strictObject({
  schema: z.literal(1),
  ids: z
    .array(
      z.strictObject({
        id: idSchema,
        kind: z.enum(["skill", "lesson", "template"]),
        status: statusSchema,
        notes: asciiLine(1, 240).optional(),
      }),
    )
    .min(1),
});

export type GroupInput = z.infer<typeof groupSchema>;
export type SkillInput = z.infer<typeof skillSchema>;
export type LessonInput = z.infer<typeof lessonSchema>;
export type TemplateInput = z.infer<typeof templateSchema>;
export type PoolInput = z.infer<typeof poolSchema>;
export type PresetEntryInput = z.infer<typeof presetEntrySchema>;
export type CompatibilityInput = z.infer<typeof compatibilitySchema>;
export type RegistryInput = z.infer<typeof registrySchema>;
export type PickOpInput = z.infer<typeof pickOpSchema>;
export type LineOpInput = z.infer<typeof lineOpSchema>;
export type BufferOpInput = z.infer<typeof bufferOpSchema>;
export type ConstraintsInput = z.infer<typeof constraintsSchema>;
