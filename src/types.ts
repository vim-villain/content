import type { Position } from "@vim-villain/engine";

export type SkillId = string;
export type LessonId = string;
export type TemplateId = string;
export type LessonSlug = string;
export type ChallengeType = "move-to-target" | "edit-to-match";
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface SkillSummary {
  readonly id: SkillId;
  readonly title: string;
  readonly group: string;
  readonly summary: string;
  readonly order: number;
  readonly prerequisites: readonly SkillId[];
  readonly tags: readonly string[];
}

export interface SkillDetail extends SkillSummary {
  readonly description: string;
  readonly lessonIds: readonly LessonId[];
}

export interface LessonSummary {
  readonly id: LessonId;
  readonly slug: LessonSlug;
  readonly title: string;
  readonly summary: string;
  readonly group: string;
  readonly order: number;
  readonly difficulty: Difficulty;
  readonly skillIds: readonly SkillId[];
  readonly prerequisiteSkillIds: readonly SkillId[];
  readonly challengeTypes: readonly ChallengeType[];
  readonly tags: readonly string[];
}

export interface LessonDetail extends LessonSummary {
  readonly instructions: string;
  readonly hints: readonly string[];
  readonly keyLegend: readonly string[];
  readonly contentVersion: string;
  readonly schemaVersion: number;
}

export interface CurriculumGroup {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly order: number;
  readonly lessons: readonly LessonSummary[];
}

export interface Curriculum {
  readonly contentVersion: string;
  readonly schemaVersion: number;
  readonly groups: readonly CurriculumGroup[];
  readonly skills: readonly SkillSummary[];
}

export interface CursorGoal {
  readonly kind: "cursor";
  readonly cursor: Position;
}

export interface BufferGoal {
  readonly kind: "buffer";
  readonly buffer: readonly string[];
}

export type Goal = CursorGoal | BufferGoal;

export interface GeneratedInstance {
  readonly schemaVersion: number;
  readonly contentVersion: string;
  readonly lessonId: LessonId;
  readonly lessonSlug: LessonSlug;
  readonly templateId: TemplateId;
  readonly challengeType: ChallengeType;
  readonly buffer: readonly string[];
  readonly cursor: Position;
  readonly goal: Goal;
  readonly allowedKeys: readonly string[];
  readonly par: number;
}

export interface JudgeState {
  readonly buffer: readonly string[];
  readonly cursor: Position;
}

export interface ContentInfo {
  readonly contentVersion: string;
  readonly buildId: string;
  readonly schemaVersion: number;
  readonly generatorVersion: number;
  readonly engineRange: string;
  readonly testedEngineVersions: readonly string[];
  readonly skillCount: number;
  readonly lessonCount: number;
  readonly templateCount: number;
}
