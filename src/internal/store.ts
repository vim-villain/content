import { RUNTIME } from "../generated/runtime.js";
import type { CompiledLesson, CompiledSkill, CompiledTemplate } from "./data.js";

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return Object.freeze(value) as T;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
    return Object.freeze(value) as T;
  }
  return value;
}

/** Frozen compiled runtime. Contains active content only. */
export const runtime = deepFreeze(RUNTIME);

export const lessonBySlug = new Map<string, CompiledLesson>();
export const lessonById = new Map<string, CompiledLesson>();
export const skillById = new Map<string, CompiledSkill>();
export const templateById = new Map<string, CompiledTemplate>();
export const templatesByLesson = new Map<string, CompiledTemplate[]>();

for (const lesson of runtime.lessons) {
  lessonBySlug.set(lesson.slug, lesson);
  lessonById.set(lesson.id, lesson);
}
for (const skill of runtime.skills) {
  skillById.set(skill.id, skill);
}
for (const template of runtime.templates) {
  templateById.set(template.id, template);
  const list = templatesByLesson.get(template.lessonId);
  if (list === undefined) {
    templatesByLesson.set(template.lessonId, [template]);
  } else {
    list.push(template);
  }
}
for (const list of templatesByLesson.values()) {
  list.sort(compareTemplate);
}

function compareTemplate(a: CompiledTemplate, b: CompiledTemplate): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
