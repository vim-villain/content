import { describe, expect, test } from "bun:test";
import {
  groupRefSchema,
  idSchema,
  skillSchema,
  tokenSchema,
} from "../scripts/lib/schema.js";

describe("authoring schema", () => {
  test("content IDs require two or more kebab segments", () => {
    expect(idSchema.safeParse("skill.motion.word").success).toBe(true);
    expect(idSchema.safeParse("lesson.word-forward").success).toBe(true);
    expect(idSchema.safeParse("skill").success).toBe(false);
    expect(idSchema.safeParse("Skill.Motion.Word").success).toBe(false);
    expect(idSchema.safeParse("skill..word").success).toBe(false);
  });

  test("group IDs are a single kebab segment", () => {
    expect(groupRefSchema.safeParse("movement").success).toBe(true);
    expect(groupRefSchema.safeParse("text-objects").success).toBe(true);
    expect(groupRefSchema.safeParse("skill.motion").success).toBe(false);
    expect(groupRefSchema.safeParse("Movement").success).toBe(false);
  });

  test("key tokens match the engine vocabulary", () => {
    for (const token of ["w", "3", " ", "Escape", "Enter", "Backspace", "Control-r"]) {
      expect(tokenSchema.safeParse(token).success).toBe(true);
    }
    for (const token of ["Esc", "F1", "", "Escape "]) {
      expect(tokenSchema.safeParse(token).success).toBe(false);
    }
  });

  test("a skill cannot use a dotted group or a single-segment ID", () => {
    const base = {
      title: "Word motions",
      group: "movement",
      order: 10,
      summary: "Move between words with w, b, and e.",
    };
    expect(
      skillSchema.safeParse({ ...base, id: "skill.motion.word" }).success,
    ).toBe(true);
    expect(
      skillSchema.safeParse({ ...base, id: "skill" }).success,
    ).toBe(false);
    expect(
      skillSchema.safeParse({ ...base, group: "skill.motion" }).success,
    ).toBe(false);
  });
});
