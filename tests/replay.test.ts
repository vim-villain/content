import { describe, expect, test } from "bun:test";
import { applyKeys, initialState } from "@vim-villain/engine";
import { generateInstance, isGoalSatisfied } from "../src/index.js";
import { GOLDENS } from "./goldens.js";
import { VALIDATION } from "./generated/validation.js";

const NORMAL_SEEDS = [
  "0000000000000001",
  "0000000000000002",
  "0000000000000003",
] as const;

describe("reference solutions", () => {
  for (const template of VALIDATION) {
    test(`${template.templateId} replays to its goal on engine 0.4.0`, () => {
      for (const seed of NORMAL_SEEDS) {
        const instance = generateInstance(template.templateId, seed);
        const { state } = applyKeys(
          initialState({
            buffer: [...instance.buffer],
            cursor: { ...instance.cursor },
          }),
          template.solution,
        );

        expect(isGoalSatisfied(instance.goal, state)).toBe(true);
        expect(template.par).toBe(template.solution.length);
        expect(instance.par).toBe(template.par);
        for (const token of template.solution) {
          expect(instance.allowedKeys).toContain(token);
        }
      }
    });
  }

  test("the initial state never already satisfies the goal", () => {
    for (const template of VALIDATION) {
      for (const seed of NORMAL_SEEDS) {
        const instance = generateInstance(template.templateId, seed);
        expect(
          isGoalSatisfied(instance.goal, {
            buffer: [...instance.buffer],
            cursor: { ...instance.cursor },
          }),
        ).toBe(false);
      }
    }
  });
});

describe("deterministic generation", () => {
  test("goldens match the committed seeds", () => {
    for (const golden of GOLDENS) {
      const instance = generateInstance(golden.templateId, golden.seed);
      expect(instance.buffer).toEqual(golden.buffer);
      expect(instance.cursor).toEqual(golden.cursor);
      expect(instance.goal).toEqual(golden.goal);
      expect(instance.par).toBe(golden.par);
    }
  });

  test("the same seed reproduces an identical instance", () => {
    for (const template of VALIDATION) {
      const seed = "00000000000000cc";
      expect(generateInstance(template.templateId, seed)).toEqual(
        generateInstance(template.templateId, seed),
      );
    }
  });

  test("different seeds produce different buffers for the seed templates", () => {
    for (const template of VALIDATION) {
      const a = generateInstance(template.templateId, "0000000000000001");
      const b = generateInstance(template.templateId, "0000000000000002");
      expect(a.buffer).not.toEqual(b.buffer);
    }
  });
});
