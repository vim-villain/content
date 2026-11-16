import { describe, expect, test } from "bun:test";
import {
  CONTENT_BUILD_ID,
  CONTENT_INFO,
  CONTENT_SCHEMA_VERSION,
  CONTENT_VERSION,
  ContentError,
  ENGINE_RANGE,
  GENERATOR_VERSION,
  TESTED_ENGINE_VERSIONS,
  generateInstance,
  getCurriculum,
  getLesson,
  getLessonById,
  getSkill,
  getSkills,
  isContentError,
  isGoalSatisfied,
  startLesson,
} from "../src/index.js";

describe("content metadata", () => {
  test("reports the seed slice and pinned engine compatibility", () => {
    expect(CONTENT_VERSION).toBe("0.1.0");
    expect(CONTENT_SCHEMA_VERSION).toBe(1);
    expect(GENERATOR_VERSION).toBe(1);
    expect(ENGINE_RANGE).toBe(">=0.4.0 <0.5.0");
    expect(TESTED_ENGINE_VERSIONS).toEqual(["0.4.0"]);
    expect(CONTENT_BUILD_ID).toMatch(/^[0-9a-f]{64}$/);
    expect(CONTENT_INFO.skillCount).toBe(4);
    expect(CONTENT_INFO.lessonCount).toBe(4);
    expect(CONTENT_INFO.templateCount).toBe(4);
  });
});

describe("curriculum API", () => {
  test("orders groups and exposes only active lessons", () => {
    const curriculum = getCurriculum();
    expect(curriculum.groups.map((group) => group.id)).toEqual([
      "movement",
      "insert",
      "operators",
    ]);
    expect(curriculum.groups.flatMap((group) => group.lessons)).toHaveLength(4);
    expect(curriculum.skills).toHaveLength(4);
    expect(curriculum.contentVersion).toBe("0.1.0");
  });

  test("lesson lookup returns detail and null for unknown slugs", () => {
    const lesson = getLesson("word-forward");
    expect(lesson).not.toBeNull();
    expect(lesson?.id).toBe("lesson.word-forward");
    expect(lesson?.skillIds).toEqual(["skill.motion.word"]);
    expect(lesson?.instructions.length).toBeGreaterThan(0);
    expect(lesson?.contentVersion).toBe("0.1.0");

    expect(getLesson("not-a-lesson")).toBeNull();
    expect(getLessonById("lesson.word-forward")?.slug).toBe("word-forward");
    expect(getLessonById("lesson.missing")).toBeNull();
  });

  test("skills resolve with their lessons and prerequisites", () => {
    const word = getSkill("skill.motion.word");
    expect(word?.group).toBe("movement");
    expect(word?.lessonIds).toEqual(["lesson.word-forward"]);

    const remove = getSkill("skill.operator.delete");
    expect(remove?.prerequisites).toEqual(["skill.motion.word"]);
    expect(getSkills()).toHaveLength(4);
    expect(getSkill("skill.missing")).toBeNull();
  });
});

describe("generation API", () => {
  test("startLesson is deterministic for an exact slug and seed", () => {
    const seed = "00000000000000aa";
    const first = startLesson("word-forward", seed);
    const second = startLesson("word-forward", seed);

    expect(first).toEqual(second);
    expect(first.templateId).toBe("template.word-forward.basic");
    expect(first.challengeType).toBe("move-to-target");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.buffer)).toBe(true);
    expect("solution" in first).toBe(false);
  });

  test("generateInstance resolves an exact template and rejects unknown IDs", () => {
    const instance = generateInstance(
      "template.delete-word.dw",
      "00000000000000bb",
    );
    expect(instance.templateId).toBe("template.delete-word.dw");
    expect(instance.challengeType).toBe("edit-to-match");

    expect(() =>
      generateInstance("template.missing.none", "00000000000000bb"),
    ).toThrow(ContentError);
    try {
      generateInstance("template.missing.none", "00000000000000bb");
    } catch (error) {
      expect(isContentError(error)).toBe(true);
      expect((error as ContentError).code).toBe("UNKNOWN_TEMPLATE");
    }
  });

  test("rejects malformed seeds and unknown lessons with typed errors", () => {
    for (const seed of ["", "xyz", "0".repeat(15), "0".repeat(65), "A".repeat(16)]) {
      try {
        startLesson("word-forward", seed);
        throw new Error(`expected seed ${JSON.stringify(seed)} to fail`);
      } catch (error) {
        expect(isContentError(error)).toBe(true);
        expect((error as ContentError).code).toBe("INVALID_SEED");
      }
    }

    try {
      startLesson("missing-lesson", "0000000000000001");
      throw new Error("expected unknown lesson to fail");
    } catch (error) {
      expect(isContentError(error)).toBe(true);
      expect((error as ContentError).code).toBe("UNKNOWN_LESSON");
    }
  });
});

describe("goal judging", () => {
  test("judges cursor and buffer goals exactly", () => {
    expect(
      isGoalSatisfied(
        { kind: "cursor", cursor: { line: 0, col: 3 } },
        { buffer: ["abcd"], cursor: { line: 0, col: 3 } },
      ),
    ).toBe(true);
    expect(
      isGoalSatisfied(
        { kind: "cursor", cursor: { line: 0, col: 3 } },
        { buffer: ["abcd"], cursor: { line: 0, col: 2 } },
      ),
    ).toBe(false);
    expect(
      isGoalSatisfied(
        { kind: "buffer", buffer: ["done"] },
        { buffer: ["done"], cursor: { line: 0, col: 0 } },
      ),
    ).toBe(true);
    expect(
      isGoalSatisfied(
        { kind: "buffer", buffer: ["done"] },
        { buffer: ["Done"], cursor: { line: 0, col: 0 } },
      ),
    ).toBe(false);
  });

  test("malformed input returns false rather than throwing", () => {
    expect(
      isGoalSatisfied(
        null as unknown as { kind: "cursor"; cursor: { line: 0; col: 0 } },
        { buffer: [""], cursor: { line: 0, col: 0 } },
      ),
    ).toBe(false);
  });
});
