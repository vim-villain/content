import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as semver from "semver";
import type { z } from "zod";
import type {
  BufferRef,
  CompiledCompatibility,
  CompiledCursor,
  CompiledGroup,
  CompiledLesson,
  CompiledOp,
  CompiledPart,
  CompiledRuntime,
  CompiledSkill,
  CompiledTemplate,
} from "../../src/internal/data.js";
import { canonicalJson, sha256Hex } from "./canonical.js";
import type { Collector } from "./errors.js";
import { REPO_ROOT } from "./load.js";
import type {
  RawContent,
  RawEntry,
  RawLesson,
  RawSkill,
  RawTemplate,
} from "./load.js";
import {
  compatibilitySchema,
  groupsFileSchema,
  lessonSchema,
  poolSchema,
  presetsFileSchema,
  registrySchema,
  skillSchema,
  templateSchema,
  type BufferOpInput,
  type CompatibilityInput,
  type ConstraintsInput,
  type GroupInput,
  type LessonInput,
  type LineOpInput,
  type PickOpInput,
  type PoolInput,
  type SkillInput,
  type TemplateInput,
} from "./schema.js";
import { MOTION_TOKENS } from "./tokens.js";
import { pointer } from "./yaml.js";

export const CONTENT_SCHEMA_VERSION = 1;
export const GENERATOR_VERSION = 1;

export interface CompileOutput {
  runtime: CompiledRuntime;
  compatibility: CompiledCompatibility;
  buildId: string;
  /** CI-only. Never written into the runtime artifact. */
  solutions: Record<string, string[]>;
  /** CI-only per-template engine range. */
  engineRanges: Record<string, string>;
}

interface ParsedSkill {
  entry: RawSkill;
  value: SkillInput;
  status: "active" | "draft" | "retired";
}

interface ParsedLesson {
  entry: RawLesson;
  value: LessonInput;
  status: "active" | "draft" | "retired";
}

interface ParsedTemplate {
  entry: RawTemplate;
  value: TemplateInput;
  status: "active" | "draft" | "retired";
}

interface CompileContext {
  pools: Map<string, PoolInput>;
  presets: Map<string, string[]>;
  tested: string[];
  collector: Collector;
}

interface FactMeta {
  kind: "pick" | "line" | "buffer";
  pickCount?: number;
  spans?: Set<string>;
  lines?: Array<{ kind: "line"; name: string } | { kind: "text"; text: string }>;
}

function parseSchema<T>(
  schema: z.ZodType<T>,
  entry: RawEntry,
  collector: Collector,
  hint: string,
): T | undefined {
  const result = schema.safeParse(entry.data);
  if (result.success) {
    return result.data;
  }
  for (const issue of result.error.issues) {
    collector.add(
      "E_SCHEMA",
      entry.rel,
      pointer(
        ...issue.path.map((segment) =>
          typeof segment === "symbol" ? segment.toString() : segment,
        ),
      ),
      issue.message,
      hint,
    );
  }
  return undefined;
}

function statusOf(value: {
  status?: "active" | "draft" | "retired" | undefined;
}) {
  return value.status ?? "active";
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compileContent(
  raw: RawContent,
  collector: Collector,
): CompileOutput {
  const packageJson = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  ) as { version: string };

  // ---- groups ------------------------------------------------------------
  let groups: GroupInput[] = [];
  if (raw.groups !== null) {
    const parsed = parseSchema(
      groupsFileSchema,
      raw.groups,
      collector,
      "see group field rules in ARCHITECTURE.md §4.2.",
    );
    if (parsed !== undefined) {
      groups = parsed;
    }
  }
  const groupIds = new Set<string>();
  const groupOrder = new Map<string, number>();
  for (const [index, group] of groups.entries()) {
    if (groupIds.has(group.id)) {
      collector.add(
        "E_ID",
        raw.groups?.rel ?? "content/groups.yaml",
        pointer(index, "id"),
        `duplicate group ID "${group.id}".`,
        "group IDs are unique and permanent.",
      );
    }
    groupIds.add(group.id);
    if (groupOrder.has(String(group.order))) {
      collector.add(
        "E_ORDER",
        raw.groups?.rel ?? "content/groups.yaml",
        pointer(index, "order"),
        `duplicate group order ${group.order}.`,
        "order values are unique within their scope.",
      );
    }
    groupOrder.set(String(group.order), group.order);
  }

  // ---- compatibility -----------------------------------------------------
  let compatibility: CompatibilityInput = {
    engineRange: ">=0.4.0 <0.5.0",
    tested: ["0.4.0"],
  };
  if (raw.compatibility !== null) {
    const parsed = parseSchema(
      compatibilitySchema,
      raw.compatibility,
      collector,
      "declare engineRange and exact tested x.y.z versions.",
    );
    if (parsed !== undefined) {
      compatibility = parsed;
    }
  }
  const tested = compatibility.tested.slice();
  for (let i = 0; i < tested.length; i++) {
    const version = tested[i] as string;
    if (!semver.valid(version)) {
      collector.add(
        "E_VERSION",
        raw.compatibility?.rel ?? "content/compatibility.yaml",
        pointer("tested", i),
        `"${version}" is not an exact semver version.`,
        "use an exact x.y.z version.",
      );
    }
    if (i > 0) {
      const previous = tested[i - 1] as string;
      if (semver.valid(previous) && semver.valid(version)) {
        if (semver.gte(previous, version)) {
          collector.add(
            "E_VERSION",
            raw.compatibility?.rel ?? "content/compatibility.yaml",
            pointer("tested", i),
            "tested versions must be strictly ascending and unique.",
            "list exact versions in ascending order.",
          );
        }
        const prevMinor = semver.minor(previous);
        const minor = semver.minor(version);
        if (
          semver.major(previous) === semver.major(version) &&
          minor - prevMinor > 1
        ) {
          collector.add(
            "E_VERSION",
            raw.compatibility?.rel ?? "content/compatibility.yaml",
            pointer("tested", i),
            `tested versions skip minor ${prevMinor + 1}.`,
            "tested minors must be contiguous.",
          );
        }
      }
    }
  }
  if (!semver.validRange(compatibility.engineRange)) {
    collector.add(
      "E_VERSION",
      raw.compatibility?.rel ?? "content/compatibility.yaml",
      pointer("engineRange"),
      `"${compatibility.engineRange}" is not a valid semver range.`,
      "use a narrow semver range derived from the tested list.",
    );
  }
  const peerRange = (
    JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      peerDependencies?: Record<string, string>;
    }
  ).peerDependencies?.["@vim-villain/engine"];
  if (peerRange !== compatibility.engineRange) {
    collector.add(
      "E_VERSION",
      "package.json",
      pointer("peerDependencies", "@vim-villain/engine"),
      `peer range "${String(peerRange)}" does not equal compatibility.yaml engineRange "${compatibility.engineRange}".`,
      "keep the peer range and compatibility.yaml in sync.",
    );
  }

  // ---- pools -------------------------------------------------------------
  const pools = new Map<string, PoolInput>();
  for (const pool of raw.pools) {
    const value = parseSchema(
      poolSchema,
      pool,
      collector,
      "see pool field rules in ARCHITECTURE.md §4.6.",
    );
    if (value === undefined) {
      continue;
    }
    const derivedId = `${pool.namespace}.${pool.name}`;
    if (value.id !== derivedId) {
      collector.add(
        "E_ID",
        pool.rel,
        pointer("id"),
        `authored id "${value.id}" does not match path-derived "${derivedId}".`,
        "make the id match the pool file path.",
      );
    }
    if (pools.has(value.id)) {
      collector.add(
        "E_ID",
        pool.rel,
        pointer("id"),
        `duplicate pool ID "${value.id}".`,
        "pool IDs are globally unique.",
      );
    }
    const seen = new Set<string>();
    for (const [index, item] of value.items.entries()) {
      if (seen.has(item)) {
        collector.add(
          "E_LIMIT",
          pool.rel,
          pointer("items", index),
          `duplicate pool item "${item}".`,
          "pool items must be unique.",
        );
      }
      seen.add(item);
      const valid =
        value.kind === "word"
          ? /^[a-z]{2,12}$/.test(item)
          : /^[\x21-\x7e]{1,20}$/.test(item);
      if (!valid) {
        collector.add(
          "E_LIMIT",
          pool.rel,
          pointer("items", index),
          `item "${item}" does not match pool kind "${value.kind}".`,
          "word items are 2-12 lowercase letters; big-word items have no spaces.",
        );
      }
    }
    if (!pools.has(value.id)) {
      pools.set(value.id, value);
    }
  }

  // ---- presets -----------------------------------------------------------
  const presets = new Map<string, string[]>();
  if (raw.presets !== null) {
    const parsed = parseSchema(
      presetsFileSchema,
      raw.presets,
      collector,
      "see preset rules in ARCHITECTURE.md §4.8.",
    );
    if (parsed !== undefined) {
      for (const [index, preset] of parsed.presets.entries()) {
        if (presets.has(preset.name)) {
          collector.add(
            "E_ALLOWED",
            raw.presets.rel,
            pointer("presets", index, "name"),
            `duplicate preset "${preset.name}".`,
            "preset names are unique.",
          );
          continue;
        }
        presets.set(preset.name, preset.keys);
      }
    }
  } else {
    collector.add(
      "E_ALLOWED",
      "content/presets/allowed-keys.yaml",
      "/",
      "missing allowed-key presets file.",
      "add content/presets/allowed-keys.yaml.",
    );
  }

  // ---- skills ------------------------------------------------------------
  const skills: ParsedSkill[] = [];
  const skillById = new Map<string, ParsedSkill>();
  const skillOrder = new Set<string>();
  for (const entry of raw.skills) {
    const value = parseSchema(
      skillSchema,
      entry,
      collector,
      "see skill field rules in ARCHITECTURE.md §4.3.",
    );
    if (value === undefined) {
      continue;
    }
    const derivedId = `skill.${entry.group}.${entry.name}`;
    if (value.id !== derivedId) {
      collector.add(
        "E_ID",
        entry.rel,
        pointer("id"),
        `authored id "${value.id}" does not match path-derived "${derivedId}".`,
        "make the id match the skill file path.",
      );
    }
    // The directory is the skill namespace (the middle ID segment). The
    // `group` field is presentation metadata and may differ from the namespace.
    if (value.id.split(".")[1] !== entry.group) {
      collector.add(
        "E_ID",
        entry.rel,
        pointer("id"),
        `skill namespace "${entry.group}" does not match id "${value.id}".`,
        "the directory is the namespace; make it match the middle id segment.",
      );
    }
    if (!groupIds.has(value.group)) {
      collector.add(
        "E_REF",
        entry.rel,
        pointer("group"),
        `unknown group "${value.group}".`,
        "add the group to content/groups.yaml.",
      );
    }
    if (skillById.has(value.id)) {
      collector.add(
        "E_ID",
        entry.rel,
        pointer("id"),
        `duplicate skill ID "${value.id}".`,
        "IDs are globally unique.",
      );
    }
    if (skillOrder.has(`${value.group}:${value.order}`)) {
      collector.add(
        "E_ORDER",
        entry.rel,
        pointer("order"),
        `duplicate skill order ${value.order} in group "${value.group}".`,
        "skill order values are unique within a group.",
      );
    }
    skillOrder.add(`${value.group}:${value.order}`);
    const tags = value.tags ?? [];
    if (new Set(tags).size !== tags.length) {
      collector.add(
        "E_SCHEMA",
        entry.rel,
        pointer("tags"),
        "tags must be unique.",
        "remove duplicate tags.",
      );
    }
    const status = statusOf(value);
    if (status === "retired") {
      collector.add(
        "E_STATUS",
        entry.rel,
        pointer("status"),
        "retired skills have no file; keep the ID in the registry only.",
        "remove the file or change the status.",
      );
    }
    const parsed: ParsedSkill = { entry, value, status };
    if (!skillById.has(value.id)) {
      skillById.set(value.id, parsed);
      skills.push(parsed);
    }
  }

  // Prerequisite references and cycles.
  for (const skill of skills) {
    const prerequisites = skill.value.prerequisites ?? [];
    const seen = new Set<string>();
    for (const [index, prerequisite] of prerequisites.entries()) {
      if (seen.has(prerequisite)) {
        collector.add(
          "E_SCHEMA",
          skill.entry.rel,
          pointer("prerequisites", index),
          `duplicate prerequisite "${prerequisite}".`,
          "list each prerequisite once.",
        );
      }
      seen.add(prerequisite);
      if (prerequisite === skill.value.id) {
        collector.add(
          "E_CYCLE",
          skill.entry.rel,
          pointer("prerequisites", index),
          `skill "${skill.value.id}" lists itself as a prerequisite.`,
          "remove the self-reference.",
        );
      } else if (!skillById.has(prerequisite)) {
        collector.add(
          "E_REF",
          skill.entry.rel,
          pointer("prerequisites", index),
          `unknown prerequisite skill "${prerequisite}".`,
          "add the skill or remove the reference.",
        );
      }
    }
  }
  detectSkillCycles(skills, collector);

  // ---- lessons -----------------------------------------------------------
  const lessons: ParsedLesson[] = [];
  const lessonById = new Map<string, ParsedLesson>();
  const lessonOrder = new Set<string>();
  const slugOwner = new Map<string, string>();
  for (const entry of raw.lessons) {
    const value = parseSchema(
      lessonSchema,
      entry,
      collector,
      "see lesson field rules in ARCHITECTURE.md §4.4.",
    );
    if (value === undefined) {
      continue;
    }
    const derivedId = `lesson.${entry.slug}`;
    if (value.id !== derivedId) {
      collector.add(
        "E_ID",
        entry.rel,
        pointer("id"),
        `authored id "${value.id}" does not match path-derived "${derivedId}".`,
        "make the id match the lesson directory.",
      );
    }
    if (value.slug !== entry.slug) {
      collector.add(
        "E_ID",
        entry.rel,
        pointer("slug"),
        `slug "${value.slug}" does not match directory "${entry.slug}".`,
        "make the slug match the lesson directory.",
      );
    }
    if (value.group !== entry.group) {
      collector.add(
        "E_ID",
        entry.rel,
        pointer("group"),
        `group "${value.group}" does not match path group "${entry.group}".`,
        "make the group field match the directory.",
      );
    }
    if (!groupIds.has(value.group)) {
      collector.add(
        "E_REF",
        entry.rel,
        pointer("group"),
        `unknown group "${value.group}".`,
        "add the group to content/groups.yaml.",
      );
    }
    if (lessonById.has(value.id)) {
      collector.add(
        "E_ID",
        entry.rel,
        pointer("id"),
        `duplicate lesson ID "${value.id}".`,
        "IDs are globally unique.",
      );
    }
    if (lessonOrder.has(`${value.group}:${value.order}`)) {
      collector.add(
        "E_ORDER",
        entry.rel,
        pointer("order"),
        `duplicate lesson order ${value.order} in group "${value.group}".`,
        "lesson order values are unique within a group.",
      );
    }
    lessonOrder.add(`${value.group}:${value.order}`);
    const existingSlug = slugOwner.get(value.slug);
    if (existingSlug !== undefined) {
      collector.add(
        "E_SLUG",
        entry.rel,
        pointer("slug"),
        `slug "${value.slug}" is already used by "${existingSlug}".`,
        "slugs are globally unique and never reused.",
      );
    } else {
      slugOwner.set(value.slug, value.id);
    }
    const status = statusOf(value);
    if (status === "retired") {
      collector.add(
        "E_STATUS",
        entry.rel,
        pointer("status"),
        "retired lessons have no file; keep the ID in the registry only.",
        "remove the file or change the status.",
      );
    }
    for (const [index, skillId] of value.skills.entries()) {
      if (!skillById.has(skillId)) {
        collector.add(
          "E_REF",
          entry.rel,
          pointer("skills", index),
          `unknown skill "${skillId}".`,
          "add the skill or remove the reference.",
        );
      }
    }
    const primary = skillById.get(value.skills[0] as string);
    if (primary !== undefined && primary.value.group !== value.group) {
      collector.add(
        "E_STATUS",
        entry.rel,
        pointer("skills", 0),
        `primary skill "${primary.value.id}" is in group "${primary.value.group}", not "${value.group}".`,
        "the primary skill's group must equal the lesson's group.",
      );
    }
    if (new Set(value.skills).size !== value.skills.length) {
      collector.add(
        "E_SCHEMA",
        entry.rel,
        pointer("skills"),
        "skill IDs must be unique within a lesson.",
        "remove the duplicate skill.",
      );
    }
    const parsed: ParsedLesson = { entry, value, status };
    if (!lessonById.has(value.id)) {
      lessonById.set(value.id, parsed);
      lessons.push(parsed);
    }
  }

  // ---- templates ---------------------------------------------------------
  const templates: ParsedTemplate[] = [];
  const templateById = new Map<string, ParsedTemplate>();
  const templateOrder = new Set<string>();
  for (const entry of raw.templates) {
    const value = parseSchema(
      templateSchema,
      entry,
      collector,
      "see template field rules in ARCHITECTURE.md §4.5.",
    );
    if (value === undefined) {
      continue;
    }
    const derivedId = `template.${entry.slug}.${entry.variant}`;
    if (value.id !== derivedId) {
      collector.add(
        "E_ID",
        entry.rel,
        pointer("id"),
        `authored id "${value.id}" does not match path-derived "${derivedId}".`,
        "make the id match the template file path.",
      );
    }
    const expectedLesson = `lesson.${entry.slug}`;
    if (value.lesson !== expectedLesson) {
      collector.add(
        "E_REF",
        entry.rel,
        pointer("lesson"),
        `lesson "${value.lesson}" does not match parent "${expectedLesson}".`,
        "make the lesson field match the parent lesson directory.",
      );
    }
    if (!lessonById.has(expectedLesson)) {
      collector.add(
        "E_REF",
        entry.rel,
        pointer("lesson"),
        `unknown parent lesson "${expectedLesson}".`,
        "add the lesson before its templates.",
      );
    }
    if (templateById.has(value.id)) {
      collector.add(
        "E_ID",
        entry.rel,
        pointer("id"),
        `duplicate template ID "${value.id}".`,
        "IDs are globally unique.",
      );
    }
    if (templateOrder.has(`${expectedLesson}:${value.order}`)) {
      collector.add(
        "E_ORDER",
        entry.rel,
        pointer("order"),
        `duplicate template order ${value.order} in "${expectedLesson}".`,
        "template order values are unique within a lesson.",
      );
    }
    templateOrder.add(`${expectedLesson}:${value.order}`);
    if (value.type === "move-to-target" && value.goal.kind !== "cursor") {
      collector.add(
        "E_GOAL",
        entry.rel,
        pointer("goal", "kind"),
        "move-to-target requires a cursor goal.",
        "use goal.kind: cursor.",
      );
    }
    if (value.type === "edit-to-match" && value.goal.kind !== "buffer") {
      collector.add(
        "E_GOAL",
        entry.rel,
        pointer("goal", "kind"),
        "edit-to-match requires a buffer goal.",
        "use goal.kind: buffer.",
      );
    }
    if (!semver.validRange(value.engine)) {
      collector.add(
        "E_VERSION",
        entry.rel,
        pointer("engine"),
        `"${value.engine}" is not a valid semver range.`,
        "use a narrow semver range.",
      );
    }
    const status = statusOf(value);
    if (status === "retired") {
      collector.add(
        "E_STATUS",
        entry.rel,
        pointer("status"),
        "retired templates have no file; keep the ID in the registry only.",
        "remove the file or change the status.",
      );
    }
    if (status === "active") {
      for (const version of tested) {
        if (
          semver.validRange(value.engine) &&
          !semver.satisfies(version, value.engine)
        ) {
          collector.add(
            "E_VERSION",
            entry.rel,
            pointer("engine"),
            `active template does not support tested engine ${version}.`,
            "widen the range, or keep this template draft until the tested set matches.",
          );
        }
      }
    }
    const parsed: ParsedTemplate = { entry, value, status };
    if (!templateById.has(value.id)) {
      templateById.set(value.id, parsed);
      templates.push(parsed);
    }
  }

  // ---- registry ----------------------------------------------------------
  const registryIds = new Map<
    string,
    { kind: string; status: string; rel: string }
  >();
  if (raw.registry !== null) {
    const parsed = parseSchema(
      registrySchema,
      raw.registry,
      collector,
      "see registry rules in ARCHITECTURE.md §7.3.",
    );
    if (parsed !== undefined) {
      let previous = "";
      for (const [index, record] of parsed.ids.entries()) {
        if (record.id <= previous) {
          collector.add(
            "E_REGISTRY",
            raw.registry.rel,
            pointer("ids", index, "id"),
            `registry IDs must be sorted; "${record.id}" follows "${previous}".`,
            "sort the ids array lexicographically.",
          );
        }
        previous = record.id;
        if (registryIds.has(record.id)) {
          collector.add(
            "E_REGISTRY",
            raw.registry.rel,
            pointer("ids", index, "id"),
            `duplicate registry ID "${record.id}".`,
            "each ID is recorded once.",
          );
          continue;
        }
        if (!record.id.startsWith(`${record.kind}.`)) {
          collector.add(
            "E_REGISTRY",
            raw.registry.rel,
            pointer("ids", index, "id"),
            `kind "${record.kind}" does not match ID prefix "${record.id}".`,
            "use skill., lesson., or template. consistently.",
          );
        }
        registryIds.set(record.id, {
          kind: record.kind,
          status: record.status,
          rel: raw.registry.rel,
        });
      }
    }
  }

  const fileRecords: Array<{
    id: string;
    kind: "skill" | "lesson" | "template";
    status: string;
    rel: string;
  }> = [
    ...skills.map((skill) => ({
      id: skill.value.id,
      kind: "skill" as const,
      status: skill.status,
      rel: skill.entry.rel,
    })),
    ...lessons.map((lesson) => ({
      id: lesson.value.id,
      kind: "lesson" as const,
      status: lesson.status,
      rel: lesson.entry.rel,
    })),
    ...templates.map((template) => ({
      id: template.value.id,
      kind: "template" as const,
      status: template.status,
      rel: template.entry.rel,
    })),
  ];

  if (registryIds.size > 0) {
    for (const record of fileRecords) {
      const registered = registryIds.get(record.id);
      if (registered === undefined) {
        collector.add(
          "E_REGISTRY",
          record.rel,
          pointer("id"),
          `ID "${record.id}" is on disk but missing from registry/ids.yaml.`,
          `add it with kind: ${record.kind} and status: ${record.status}.`,
        );
      } else if (registered.kind !== record.kind) {
        collector.add(
          "E_REGISTRY",
          record.rel,
          pointer("id"),
          `registry kind "${registered.kind}" does not match "${record.kind}".`,
          "fix the registry kind.",
        );
      } else if (registered.status !== record.status) {
        collector.add(
          "E_REGISTRY",
          record.rel,
          pointer("status"),
          `file status "${record.status}" does not match registry status "${registered.status}".`,
          "active/draft/retired status must agree.",
        );
      }
    }

    for (const [id, record] of registryIds) {
      if (record.status === "retired") {
        const file = fileRecords.find((item) => item.id === id);
        if (file !== undefined) {
          collector.add(
            "E_REGISTRY",
            file.rel,
            pointer("id"),
            `ID "${id}" is retired in the registry and must not have a file.`,
            "remove the file; retired IDs are never reused.",
          );
        }
      } else {
        const file = fileRecords.find((item) => item.id === id);
        if (file === undefined) {
          collector.add(
            "E_REGISTRY",
            "registry/ids.yaml",
            pointer("ids"),
            `registry ID "${id}" is ${record.status} but has no file.`,
            "add the file or mark the ID retired.",
          );
        }
      }
    }

    // Retired lesson slugs stay reserved.
    for (const [id, record] of registryIds) {
      if (record.kind !== "lesson") {
        continue;
      }
      const slug = id.slice("lesson.".length);
      const owner = slugOwner.get(slug);
      if (owner !== undefined && owner !== id) {
        collector.add(
          "E_SLUG",
          lessons.find((lesson) => lesson.value.slug === slug)?.entry.rel ??
            "registry/ids.yaml",
          pointer("slug"),
          `slug "${slug}" is already used by "${owner}" or a retired lesson.`,
          "slugs are never reused; choose a new slug.",
        );
      }
      if (record.status === "retired" && owner === undefined) {
        slugOwner.set(slug, id);
      }
    }
  }

  // ---- status rules ------------------------------------------------------
  const templatesByLesson = new Map<string, ParsedTemplate[]>();
  for (const template of templates) {
    const lessonId = template.value.lesson;
    const list = templatesByLesson.get(lessonId);
    if (list === undefined) {
      templatesByLesson.set(lessonId, [template]);
    } else {
      list.push(template);
    }
  }

  for (const lesson of lessons) {
    const list = templatesByLesson.get(lesson.value.id) ?? [];
    if (lesson.status === "active") {
      for (const [index, skillId] of lesson.value.skills.entries()) {
        const skill = skillById.get(skillId);
        if (skill !== undefined && skill.status !== "active") {
          collector.add(
            "E_STATUS",
            lesson.entry.rel,
            pointer("skills", index),
            `active lesson references non-active skill "${skillId}".`,
            "activate the skill or make the lesson draft.",
          );
        }
      }
      if (!list.some((template) => template.status === "active")) {
        collector.add(
          "E_STATUS",
          lesson.entry.rel,
          pointer("id"),
          "active lesson has no active template.",
          "add an active template or make the lesson draft.",
        );
      }
    } else if (lesson.status === "draft") {
      for (const template of list) {
        if (template.status === "active") {
          collector.add(
            "E_STATUS",
            template.entry.rel,
            pointer("status"),
            `draft lesson "${lesson.value.id}" has an active template.`,
            "make the template draft, or activate the lesson.",
          );
        }
      }
    }
  }

  for (const skill of skills) {
    if (skill.status !== "active") {
      continue;
    }
    const teaches = lessons.some(
      (lesson) =>
        lesson.status === "active" && lesson.value.skills.includes(skill.value.id),
    );
    if (!teaches) {
      collector.add(
        "E_STATUS",
        skill.entry.rel,
        pointer("id"),
        `active skill "${skill.value.id}" has no active lesson.`,
        "add an active lesson or make the skill draft.",
      );
    }
    for (const [index, prerequisite] of (
      skill.value.prerequisites ?? []
    ).entries()) {
      const target = skillById.get(prerequisite);
      if (target !== undefined && target.status !== "active") {
        collector.add(
          "E_STATUS",
          skill.entry.rel,
          pointer("prerequisites", index),
          `active skill requires non-active skill "${prerequisite}".`,
          "activate the prerequisite or make this skill draft.",
        );
      }
    }
  }

  // ---- compile active templates -----------------------------------------
  const context: CompileContext = {
    pools,
    presets,
    tested,
    collector,
  };

  const compiledTemplates: CompiledTemplate[] = [];
  const solutions: Record<string, string[]> = {};
  const engineRanges: Record<string, string> = {};
  for (const template of templates) {
    engineRanges[template.value.id] = template.value.engine;
    solutions[template.value.id] = template.value.solution.keys.slice();
    if (template.status !== "active") {
      continue;
    }
    const lesson = lessonById.get(template.value.lesson);
    if (lesson === undefined) {
      continue;
    }
    const compiled = compileTemplate(template, lesson, context);
    if (compiled !== undefined) {
      compiledTemplates.push(compiled);
    }
  }

  collector.throwIfFailed();

  const compiledGroups: CompiledGroup[] = groups
    .slice()
    .sort((a, b) => a.order - b.order || compareStrings(a.id, b.id))
    .map((group) => ({
      id: group.id,
      title: group.title,
      description: group.description,
      order: group.order,
    }));

  const compiledSkills: CompiledSkill[] = skills
    .filter((skill) => skill.status === "active")
    .map((skill) => ({
      id: skill.value.id,
      title: skill.value.title,
      group: skill.value.group,
      order: skill.value.order,
      summary: skill.value.summary,
      description: skill.value.description ?? "",
      prerequisites: (skill.value.prerequisites ?? []).slice(),
      tags: (skill.value.tags ?? []).slice(),
    }))
    .sort((a, b) => compareStrings(a.id, b.id));

  const compiledLessons: CompiledLesson[] = lessons
    .filter((lesson) => lesson.status === "active")
    .map((lesson) => ({
      id: lesson.value.id,
      slug: lesson.value.slug,
      title: lesson.value.title,
      group: lesson.value.group,
      order: lesson.value.order,
      difficulty: lesson.value.difficulty,
      skills: lesson.value.skills.slice(),
      summary: lesson.value.summary,
      instructions: lesson.value.instructions,
      hints: (lesson.value.hints ?? []).slice(),
      keyLegend: (lesson.value.keyLegend ?? []).slice(),
      tags: (lesson.value.tags ?? []).slice(),
    }))
    .sort((a, b) => compareStrings(a.id, b.id));

  compiledTemplates.sort((a, b) => compareStrings(a.id, b.id));

  const runtime: CompiledRuntime = {
    contentVersion: packageJson.version,
    schemaVersion: CONTENT_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    groups: compiledGroups,
    skills: compiledSkills,
    lessons: compiledLessons,
    templates: compiledTemplates,
  };

  const buildId = sha256Hex(
    canonicalJson({
      generatorVersion: GENERATOR_VERSION,
      schemaVersion: CONTENT_SCHEMA_VERSION,
      groups: runtime.groups,
      skills: runtime.skills,
      lessons: runtime.lessons,
      templates: runtime.templates,
    }),
  );

  return {
    runtime,
    compatibility: {
      engineRange: compatibility.engineRange,
      tested,
    },
    buildId,
    solutions,
    engineRanges,
  };
}

function detectSkillCycles(
  skills: ParsedSkill[],
  collector: Collector,
): void {
  const byId = new Map(skills.map((skill) => [skill.value.id, skill]));
  const state = new Map<string, "visiting" | "done">();

  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === "done") {
      return;
    }
    if (current === "visiting") {
      return;
    }
    state.set(id, "visiting");
    const skill = byId.get(id);
    for (const prerequisite of skill?.value.prerequisites ?? []) {
      if (state.get(prerequisite) === "visiting") {
        collector.add(
          "E_CYCLE",
          skill?.entry.rel ?? "content/skills",
          pointer("prerequisites"),
          `prerequisite cycle involving "${id}" and "${prerequisite}".`,
          "prerequisites must form a DAG.",
        );
        continue;
      }
      if (byId.has(prerequisite)) {
        visit(prerequisite);
      }
    }
    state.set(id, "done");
  };

  for (const skill of skills) {
    visit(skill.value.id);
  }
}

function compileTemplate(
  template: ParsedTemplate,
  lesson: ParsedLesson,
  context: CompileContext,
): CompiledTemplate | undefined {
  const { collector } = context;
  const value = template.value;
  const rel = template.entry.rel;
  const facts = new Map<string, FactMeta>();
  const ops: CompiledOp[] = [];
  let totalPicked = 0;

  for (const [opIndex, op] of value.generate.entries()) {
    if (facts.has(op.name)) {
      collector.add(
        "E_REF",
        rel,
        pointer("generate", opIndex, "name"),
        `duplicate fact name "${op.name}".`,
        "fact names are unique within a template.",
      );
      continue;
    }

    if (op.op === "pick") {
      const compiled = compilePick(op, opIndex, context, rel);
      if (compiled !== undefined) {
        totalPicked += compiled.count;
        facts.set(op.name, {
          kind: "pick",
          pickCount: compiled.count,
        });
        ops.push(compiled);
      }
      continue;
    }

    if (op.op === "line") {
      const compiled = compileLine(op, opIndex, facts, rel, collector);
      if (compiled !== undefined) {
        const spans = new Set<string>();
        for (const part of compiled.parts) {
          if (part.as !== undefined) {
            spans.add(part.as);
          }
        }
        facts.set(op.name, { kind: "line", spans });
        ops.push(compiled);
      }
      continue;
    }

    const compiled = compileBuffer(op, opIndex, facts, rel, collector);
    if (compiled !== undefined) {
      facts.set(op.name, { kind: "buffer", lines: compiled.lines });
      ops.push(compiled);
    }
  }

  if (ops.length > 0 && totalPicked > 32) {
    collector.add(
      "E_LIMIT",
      rel,
      pointer("generate"),
      `template picks ${totalPicked} items; the limit is 32.`,
      "reduce pick counts.",
    );
  }

  const initialBuffer = compileBufferRef(
    value.initial.buffer,
    "initial",
    facts,
    rel,
    collector,
  );
  const initialCursor = compileCursor(
    value.initial.cursor,
    "initial",
    value.initial.buffer,
    facts,
    rel,
    collector,
  );

  const goal =
    value.goal.kind === "cursor"
      ? compileCursorGoal(value.goal.cursor, facts, value.initial.buffer, rel, collector)
      : compileBufferGoal(value.goal.buffer, facts, rel, collector);

  if (initialBuffer === undefined || initialCursor === undefined || goal === undefined) {
    return undefined;
  }

  const allowedKeys = resolveAllowed(value, context, rel);
  if (allowedKeys === undefined) {
    return undefined;
  }

  if (value.par !== value.solution.keys.length) {
    collector.add(
      "E_PAR",
      rel,
      pointer("par"),
      `par is ${value.par} but solution.keys has ${value.solution.keys.length} tokens.`,
      "par must equal the reference solution length.",
    );
  }

  for (const [index, token] of value.solution.keys.entries()) {
    if (!allowedKeys.includes(token)) {
      collector.add(
        "E_SOLUTION",
        rel,
        pointer("solution", "keys", index),
        `key "${token}" is not in allowedKeys.`,
        "add the token to allowed, or remove it from the solution.",
      );
    }
  }

  if (value.type === "move-to-target") {
    for (const token of allowedKeys) {
      if (!MOTION_TOKENS.has(token)) {
        collector.add(
          "E_ALLOWED",
          rel,
          pointer("allowed"),
          `move-to-target allows "${token}", which is not a motion token and can change the buffer.`,
          "remove it or change the challenge type.",
        );
        break;
      }
    }
  }

  return {
    id: value.id,
    lessonId: lesson.value.id,
    lessonSlug: lesson.value.slug,
    order: value.order,
    type: value.type,
    allowedKeys,
    par: value.par,
    ops,
    initial: { buffer: initialBuffer, cursor: initialCursor },
    goal,
  };
}

function compilePick(
  op: PickOpInput,
  opIndex: number,
  context: CompileContext,
  rel: string,
): Extract<CompiledOp, { op: "pick" }> | undefined {
  const { collector } = context;
  const pool = context.pools.get(op.pool);
  if (pool === undefined) {
    collector.add(
      "E_REF",
      rel,
      pointer("generate", opIndex, "pool"),
      `unknown pool "${op.pool}".`,
      "add the pool file or fix the reference.",
    );
    return undefined;
  }

  const constraints: ConstraintsInput = op.constraints ?? {};
  if (
    constraints.length?.min !== undefined &&
    constraints.length.max !== undefined &&
    constraints.length.min > constraints.length.max
  ) {
    collector.add(
      "E_LIMIT",
      rel,
      pointer("generate", opIndex, "constraints", "length"),
      "length.min is greater than length.max.",
      "fix the bounds.",
    );
    return undefined;
  }

  const filtered = pool.items.filter((item) =>
    matchesConstraints(item, constraints),
  );
  const unique = op.unique ?? true;
  if (unique && filtered.length < op.count) {
    collector.add(
      "E_LIMIT",
      rel,
      pointer("generate", opIndex, "count"),
      `pick "${op.name}" needs ${op.count} unique items after constraints, but pool "${op.pool}" has ${filtered.length}.`,
      "relax constraints or add pool items.",
    );
    return undefined;
  }
  if (!unique && filtered.length < 1) {
    collector.add(
      "E_LIMIT",
      rel,
      pointer("generate", opIndex, "count"),
      `pool "${op.pool}" is empty after constraints.`,
      "relax constraints or add pool items.",
    );
    return undefined;
  }

  return {
    op: "pick",
    name: op.name,
    items: filtered,
    count: op.count,
    unique,
  };
}

function matchesConstraints(
  item: string,
  constraints: ConstraintsInput,
): boolean {
  const length = Array.from(item).length;
  if (
    constraints.length?.min !== undefined &&
    length < constraints.length.min
  ) {
    return false;
  }
  if (
    constraints.length?.max !== undefined &&
    length > constraints.length.max
  ) {
    return false;
  }
  if (constraints.charset === "ascii-lower" && !/^[a-z]+$/.test(item)) {
    return false;
  }
  if (constraints.charset === "ascii-alnum" && !/^[A-Za-z0-9]+$/.test(item)) {
    return false;
  }
  if (constraints.charset === "ascii" && !/^[\x20-\x7e]+$/.test(item)) {
    return false;
  }
  for (const char of constraints.forbidChars ?? "") {
    if (item.includes(char)) {
      return false;
    }
  }
  for (const char of constraints.requireChars ?? "") {
    if (!item.includes(char)) {
      return false;
    }
  }
  if (constraints.uniqueChars === true) {
    const chars = Array.from(item);
    if (new Set(chars).size !== chars.length) {
      return false;
    }
  }
  if (constraints.notIn !== undefined && constraints.notIn.includes(item)) {
    return false;
  }
  return true;
}

function compileLine(
  op: LineOpInput,
  opIndex: number,
  facts: Map<string, FactMeta>,
  rel: string,
  collector: Collector,
): Extract<CompiledOp, { op: "line" }> | undefined {
  const parts: CompiledPart[] = [];
  const spans = new Set<string>();

  for (const [partIndex, part] of op.parts.entries()) {
    let compiled: CompiledPart;
    if (part.text !== undefined) {
      if (part.as !== undefined && part.text.length === 0) {
        collector.add(
          "E_REF",
          rel,
          pointer("generate", opIndex, "parts", partIndex, "as"),
          "a span cannot name an empty part.",
          "give the part text or remove the span name.",
        );
        return undefined;
      }
      compiled = { kind: "text", text: part.text };
    } else {
      const ref = part.ref as string;
      const match = /^([a-z][a-z0-9_]{0,31})(?:\.(\d+))?$/.exec(ref);
      if (match === null) {
        collector.add(
          "E_REF",
          rel,
          pointer("generate", opIndex, "parts", partIndex, "ref"),
          `invalid ref "${ref}".`,
          "refs are a fact name or a pick element like words.0.",
        );
        return undefined;
      }
      const name = match[1] as string;
      const indexText = match[2];
      const fact = facts.get(name);
      if (fact === undefined) {
        collector.add(
          "E_REF",
          rel,
          pointer("generate", opIndex, "parts", partIndex, "ref"),
          `ref "${ref}" points at a fact that has not been defined earlier.`,
          "define the fact before referencing it.",
        );
        return undefined;
      }
      if (indexText !== undefined) {
        if (fact.kind !== "pick") {
          collector.add(
            "E_REF",
            rel,
            pointer("generate", opIndex, "parts", partIndex, "ref"),
            `ref "${ref}" indexes a non-pick fact.`,
            "index only pick facts, e.g. words.0.",
          );
          return undefined;
        }
        const index = Number(indexText);
        if ((fact.pickCount ?? 0) <= index) {
          collector.add(
            "E_REF",
            rel,
            pointer("generate", opIndex, "parts", partIndex, "ref"),
            `ref "${ref}" is out of range; the pick selects ${fact.pickCount ?? 0} items.`,
            "use an index below the pick count.",
          );
          return undefined;
        }
        compiled = { kind: "pick", name, index };
      } else {
        if (fact.kind !== "line") {
          collector.add(
            "E_REF",
            rel,
            pointer("generate", opIndex, "parts", partIndex, "ref"),
            `ref "${ref}" is not a line fact.`,
            "reference line facts by name, or a pick element like words.0.",
          );
          return undefined;
        }
        compiled = { kind: "line", name };
      }
    }

    if (part.as !== undefined) {
      if (spans.has(part.as)) {
        collector.add(
          "E_REF",
          rel,
          pointer("generate", opIndex, "parts", partIndex, "as"),
          `duplicate span name "${part.as}".`,
          "span names are unique within a line.",
        );
      }
      spans.add(part.as);
      compiled.as = part.as;
    }
    parts.push(compiled);
  }

  return { op: "line", name: op.name, parts };
}

function compileBuffer(
  op: BufferOpInput,
  opIndex: number,
  facts: Map<string, FactMeta>,
  rel: string,
  collector: Collector,
): Extract<CompiledOp, { op: "buffer" }> | undefined {
  const lines: Extract<CompiledOp, { op: "buffer" }>["lines"] = [];
  for (const [lineIndex, line] of op.lines.entries()) {
    if (line.text !== undefined) {
      lines.push({ kind: "text", text: line.text });
      continue;
    }
    const name = line.ref as string;
    const match = /^[a-z][a-z0-9_]{0,31}$/.exec(name);
    if (match === null) {
      collector.add(
        "E_REF",
        rel,
        pointer("generate", opIndex, "lines", lineIndex, "ref"),
        `invalid line ref "${name}".`,
        "buffer lines reference line facts by name.",
      );
      return undefined;
    }
    const fact = facts.get(name);
    if (fact === undefined || fact.kind !== "line") {
      collector.add(
        "E_REF",
        rel,
        pointer("generate", opIndex, "lines", lineIndex, "ref"),
        `ref "${name}" is not a previously defined line fact.`,
        "define the line fact before the buffer.",
      );
      return undefined;
    }
    lines.push({ kind: "line", name });
  }
  return { op: "buffer", name: op.name, lines };
}

function compileBufferRef(
  ref:
    | { ref: string }
    | { lit: string[] },
  where: string,
  facts: Map<string, FactMeta>,
  rel: string,
  collector: Collector,
): BufferRef | undefined {
  if ("lit" in ref) {
    for (const [index, line] of ref.lit.entries()) {
      if (Array.from(line).length > 100) {
        collector.add(
          "E_LIMIT",
          rel,
          pointer(where, "buffer", "lit", index),
          "line exceeds 100 code points.",
          "shorten the line.",
        );
        return undefined;
      }
    }
    return { lit: ref.lit.slice() };
  }
  const fact = facts.get(ref.ref);
  if (fact === undefined || fact.kind !== "buffer") {
    collector.add(
      "E_REF",
      rel,
      pointer(where, "buffer", "ref"),
      `ref "${ref.ref}" is not a buffer fact.`,
      "reference a buffer op by name.",
    );
    return undefined;
  }
  return { ref: ref.ref };
}

function compileCursor(
  spec: {
    line: number;
    col?: number | undefined;
    at?: string | undefined;
    edge?: "start" | "last" | undefined;
    offset?: number | undefined;
  },
  where: "initial",
  bufferSpec: { ref: string } | { lit: string[] },
  facts: Map<string, FactMeta>,
  rel: string,
  collector: Collector,
): CompiledCursor | undefined {
  return compileCursorInternal(spec, where, bufferSpec, facts, rel, collector);
}

function compileCursorGoal(
  spec: {
    line: number;
    col?: number | undefined;
    at?: string | undefined;
    edge?: "start" | "last" | undefined;
    offset?: number | undefined;
  },
  facts: Map<string, FactMeta>,
  bufferSpec: { ref: string } | { lit: string[] },
  rel: string,
  collector: Collector,
): { kind: "cursor"; cursor: CompiledCursor } | undefined {
  const cursor = compileCursorInternal(
    spec,
    "goal",
    bufferSpec,
    facts,
    rel,
    collector,
  );
  return cursor === undefined ? undefined : { kind: "cursor", cursor };
}

function compileBufferGoal(
  ref: { ref: string } | { lit: string[] },
  facts: Map<string, FactMeta>,
  rel: string,
  collector: Collector,
): { kind: "buffer"; buffer: BufferRef } | undefined {
  const buffer = compileBufferRef(ref, "goal", facts, rel, collector);
  return buffer === undefined ? undefined : { kind: "buffer", buffer };
}

function compileCursorInternal(
  spec: {
    line: number;
    col?: number | undefined;
    at?: string | undefined;
    edge?: "start" | "last" | undefined;
    offset?: number | undefined;
  },
  where: "initial" | "goal",
  bufferSpec: { ref: string } | { lit: string[] },
  facts: Map<string, FactMeta>,
  rel: string,
  collector: Collector,
): CompiledCursor | undefined {
  const edge = spec.edge ?? "start";
  const offset = spec.offset ?? 0;

  if (spec.at === undefined) {
    return { line: spec.line, col: spec.col as number, edge, offset };
  }

  const match = /^([a-z][a-z0-9_]{0,31})\.([a-z][a-z0-9_]{0,31})$/.exec(
    spec.at,
  );
  if (match === null) {
    collector.add(
      "E_REF",
      rel,
      pointer(where, "cursor", "at"),
      `invalid span ref "${spec.at}".`,
      "use <line>.<span>, e.g. line.third.",
    );
    return undefined;
  }
  const factName = match[1] as string;
  const spanName = match[2] as string;
  const fact = facts.get(factName);
  if (fact === undefined || fact.kind !== "line") {
    collector.add(
      "E_REF",
      rel,
      pointer(where, "cursor", "at"),
      `span ref "${spec.at}" names an unknown line fact.`,
      "define the line fact before referencing its span.",
    );
    return undefined;
  }
  if (!fact.spans?.has(spanName)) {
    collector.add(
      "E_REF",
      rel,
      pointer(where, "cursor", "at"),
      `line fact "${factName}" has no span "${spanName}".`,
      "name the span with 'as' in the line op.",
    );
    return undefined;
  }

  if (!("ref" in bufferSpec)) {
    collector.add(
      "E_REF",
      rel,
      pointer(where, "cursor", "at"),
      "a span cursor requires a buffer fact, not literal lines.",
      "build the buffer with a buffer op.",
    );
    return undefined;
  }
  const bufferFact = facts.get(bufferSpec.ref);
  if (bufferFact !== undefined && bufferFact.kind === "buffer") {
    const lines = bufferFact.lines ?? [];
    if (spec.line >= lines.length) {
      collector.add(
        "E_REF",
        rel,
        pointer(where, "cursor", "line"),
        `cursor line ${spec.line} is out of bounds for a ${lines.length}-line buffer.`,
        "point the cursor at an existing line.",
      );
      return undefined;
    }
    const entry = lines[spec.line];
    if (entry === undefined || entry.kind !== "line" || entry.name !== factName) {
      collector.add(
        "E_REF",
        rel,
        pointer(where, "cursor", "at"),
        `span ref "${spec.at}" is on line fact "${factName}", but line ${spec.line} of the initial buffer is not that fact.`,
        "use the line fact that appears at the cursor's line.",
      );
      return undefined;
    }
  }

  return {
    line: spec.line,
    at: { fact: factName, span: spanName },
    edge,
    offset,
  };
}

function resolveAllowed(
  value: TemplateInput,
  context: CompileContext,
  rel: string,
): string[] | undefined {
  const { collector } = context;
  let tokens: string[];
  if (Array.isArray(value.allowed)) {
    tokens = value.allowed.slice();
  } else {
    const preset = context.presets.get(value.allowed.preset);
    if (preset === undefined) {
      collector.add(
        "E_ALLOWED",
        rel,
        pointer("allowed", "preset"),
        `unknown allowed-key preset "${value.allowed.preset}".`,
        "add the preset to content/presets/allowed-keys.yaml.",
      );
      return undefined;
    }
    tokens = [...preset, ...(value.allowed.extra ?? [])];
  }

  const unique = Array.from(new Set(tokens)).sort(compareStrings);
  if (unique.length > 64) {
    collector.add(
      "E_ALLOWED",
      rel,
      pointer("allowed"),
      `allowed set has ${unique.length} keys; the limit is 64.`,
      "remove keys.",
    );
    return undefined;
  }
  return unique;
}
