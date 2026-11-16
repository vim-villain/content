import { runtime, lessonById, lessonBySlug, skillById } from "./internal/store.js";
import type { CompiledLesson, CompiledSkill } from "./internal/data.js";
import type {
  ChallengeType,
  Curriculum,
  CurriculumGroup,
  Difficulty,
  LessonDetail,
  LessonSummary,
  SkillDetail,
  SkillSummary,
} from "./types.js";

interface Ordering {
  readonly groupOrder: Map<string, number>;
  readonly skillRank: Map<string, number>;
  readonly lessonRank: Map<string, number>;
}

const ordering: Ordering = buildOrdering();

function buildOrdering(): Ordering {
  const groupOrder = new Map<string, number>();
  for (const group of runtime.groups) {
    groupOrder.set(group.id, group.order);
  }

  const skills = runtime.skills.slice().sort((a, b) => {
    return (
      (groupOrder.get(a.group) ?? 0) - (groupOrder.get(b.group) ?? 0) ||
      a.order - b.order ||
      compareStrings(a.id, b.id)
    );
  });
  const skillRank = new Map<string, number>();
  skills.forEach((skill, index) => skillRank.set(skill.id, index));

  const lessons = runtime.lessons.slice().sort((a, b) => {
    return (
      (groupOrder.get(a.group) ?? 0) - (groupOrder.get(b.group) ?? 0) ||
      a.order - b.order ||
      compareStrings(a.id, b.id)
    );
  });
  const lessonRank = new Map<string, number>();
  lessons.forEach((lesson, index) => lessonRank.set(lesson.id, index));

  return { groupOrder, skillRank, lessonRank };
}

function sortedSkills(): CompiledSkill[] {
  return runtime.skills.slice().sort((a, b) => {
    return (
      (ordering.groupOrder.get(a.group) ?? 0) -
        (ordering.groupOrder.get(b.group) ?? 0) ||
      a.order - b.order ||
      compareStrings(a.id, b.id)
    );
  });
}

function sortedLessons(): CompiledLesson[] {
  return runtime.lessons.slice().sort((a, b) => {
    return (
      (ordering.groupOrder.get(a.group) ?? 0) -
        (ordering.groupOrder.get(b.group) ?? 0) ||
      a.order - b.order ||
      compareStrings(a.id, b.id)
    );
  });
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function templatesFor(lessonId: string) {
  return runtime.templates
    .filter((template) => template.lessonId === lessonId)
    .sort((a, b) => a.order - b.order || compareStrings(a.id, b.id));
}

function challengeTypesFor(lessonId: string): readonly ChallengeType[] {
  const types: ChallengeType[] = [];
  const seen = new Set<string>();
  for (const template of templatesFor(lessonId)) {
    if (!seen.has(template.type)) {
      seen.add(template.type);
      types.push(template.type);
    }
  }
  return Object.freeze(types.slice());
}

function prerequisiteSkillsFor(lesson: CompiledLesson): string[] {
  const own = new Set(lesson.skills);
  const prerequisites = new Set<string>();
  for (const skillId of lesson.skills) {
    const skill = skillById.get(skillId);
    if (skill === undefined) {
      continue;
    }
    for (const prerequisite of skill.prerequisites) {
      if (!own.has(prerequisite)) {
        prerequisites.add(prerequisite);
      }
    }
  }
  return Array.from(prerequisites).sort(
    (a, b) =>
      (ordering.skillRank.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (ordering.skillRank.get(b) ?? Number.MAX_SAFE_INTEGER) ||
      compareStrings(a, b),
  );
}

function lessonSummary(lesson: CompiledLesson): LessonSummary {
  return Object.freeze({
    id: lesson.id,
    slug: lesson.slug,
    title: lesson.title,
    summary: lesson.summary,
    group: lesson.group,
    order: lesson.order,
    difficulty: lesson.difficulty as Difficulty,
    skillIds: Object.freeze(lesson.skills.slice()),
    prerequisiteSkillIds: Object.freeze(prerequisiteSkillsFor(lesson)),
    challengeTypes: challengeTypesFor(lesson.id),
    tags: Object.freeze(lesson.tags.slice()),
  });
}

function lessonDetail(lesson: CompiledLesson): LessonDetail {
  return Object.freeze({
    ...lessonSummary(lesson),
    instructions: lesson.instructions,
    hints: Object.freeze(lesson.hints.slice()),
    keyLegend: Object.freeze(lesson.keyLegend.slice()),
    contentVersion: runtime.contentVersion,
    schemaVersion: runtime.schemaVersion,
  });
}

function skillSummary(skill: CompiledSkill): SkillSummary {
  return Object.freeze({
    id: skill.id,
    title: skill.title,
    group: skill.group,
    summary: skill.summary,
    order: skill.order,
    prerequisites: Object.freeze(skill.prerequisites.slice()),
    tags: Object.freeze(skill.tags.slice()),
  });
}

function skillDetail(skill: CompiledSkill): SkillDetail {
  const lessonIds = sortedLessons()
    .filter((lesson) => lesson.skills.includes(skill.id))
    .map((lesson) => lesson.id);
  return Object.freeze({
    ...skillSummary(skill),
    description: skill.description,
    lessonIds: Object.freeze(lessonIds),
  });
}

let curriculumCache: Curriculum | null = null;

export function getCurriculum(): Curriculum {
  if (curriculumCache !== null) {
    return curriculumCache;
  }

  const groups: CurriculumGroup[] = [];
  const groupsSorted = runtime.groups
    .slice()
    .sort((a, b) => a.order - b.order || compareStrings(a.id, b.id));

  for (const group of groupsSorted) {
    const lessons = sortedLessons()
      .filter((lesson) => lesson.group === group.id)
      .map(lessonSummary);
    if (lessons.length === 0) {
      continue;
    }
    groups.push(
      Object.freeze({
        id: group.id,
        title: group.title,
        description: group.description,
        order: group.order,
        lessons: Object.freeze(lessons),
      }),
    );
  }

  const skills = sortedSkills().map(skillSummary);
  curriculumCache = Object.freeze({
    contentVersion: runtime.contentVersion,
    schemaVersion: runtime.schemaVersion,
    groups: Object.freeze(groups),
    skills: Object.freeze(skills),
  });
  return curriculumCache;
}

export function getLesson(slug: string): LessonDetail | null {
  const lesson = lessonBySlug.get(slug);
  return lesson === undefined ? null : lessonDetail(lesson);
}

export function getLessonById(id: string): LessonDetail | null {
  const lesson = lessonById.get(id);
  return lesson === undefined ? null : lessonDetail(lesson);
}

export function getSkill(id: string): SkillDetail | null {
  const skill = skillById.get(id);
  return skill === undefined ? null : skillDetail(skill);
}

let skillsCache: readonly SkillDetail[] | null = null;

export function getSkills(): readonly SkillDetail[] {
  if (skillsCache === null) {
    skillsCache = Object.freeze(sortedSkills().map(skillDetail));
  }
  return skillsCache;
}
