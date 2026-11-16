import {
  COMPATIBILITY,
  CONTENT_BUILD_ID as BUILD_ID,
  RUNTIME,
} from "./generated/runtime.js";
import type { ContentInfo } from "./types.js";

export const CONTENT_VERSION: string = RUNTIME.contentVersion;
export const CONTENT_BUILD_ID: string = BUILD_ID;
export const CONTENT_SCHEMA_VERSION: number = RUNTIME.schemaVersion;
export const GENERATOR_VERSION: number = RUNTIME.generatorVersion;
export const ENGINE_RANGE: string = COMPATIBILITY.engineRange;
export const TESTED_ENGINE_VERSIONS: readonly string[] = Object.freeze(
  COMPATIBILITY.tested.slice(),
);

export const CONTENT_INFO: ContentInfo = Object.freeze({
  contentVersion: CONTENT_VERSION,
  buildId: CONTENT_BUILD_ID,
  schemaVersion: CONTENT_SCHEMA_VERSION,
  generatorVersion: GENERATOR_VERSION,
  engineRange: ENGINE_RANGE,
  testedEngineVersions: TESTED_ENGINE_VERSIONS,
  skillCount: RUNTIME.skills.length,
  lessonCount: RUNTIME.lessons.length,
  templateCount: RUNTIME.templates.length,
});

export {
  getCurriculum,
  getLesson,
  getLessonById,
  getSkill,
  getSkills,
} from "./curriculum.js";
export { generateInstance, startLesson } from "./generate.js";
export { isGoalSatisfied } from "./judge.js";
export { ContentError, isContentError } from "./errors.js";
export type { ContentErrorCode, ContentErrorDetails } from "./errors.js";
export type {
  BufferGoal,
  ChallengeType,
  ContentInfo,
  CursorGoal,
  Curriculum,
  CurriculumGroup,
  Difficulty,
  GeneratedInstance,
  Goal,
  JudgeState,
  LessonDetail,
  LessonId,
  LessonSlug,
  LessonSummary,
  SkillDetail,
  SkillId,
  SkillSummary,
  TemplateId,
} from "./types.js";
