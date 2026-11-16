import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const distEntry = join(root, "dist", "index.js");
const hasDist = existsSync(distEntry);

const skip = !hasDist;

describe("published artifact", () => {
  test.skipIf(skip)("imports and reports the same content info", async () => {
    const dist = (await import(distEntry)) as typeof import("../src/index.js");
    const src = await import("../src/index.js");
    expect(dist.CONTENT_INFO).toEqual(src.CONTENT_INFO);
    expect(dist.CONTENT_BUILD_ID).toBe(src.CONTENT_BUILD_ID);
    expect(dist.getCurriculum().groups).toHaveLength(3);
  });

  test.skipIf(skip)("contains no reference solutions or private imports", () => {
    const text = readFileSync(distEntry, "utf8");
    for (const forbidden of [
      /"solution"\s*:/,
      /tests\/generated\/validation/,
      /content\/registry/,
      /from\s+["'](?:node:)?(?:fs|path|crypto|os|child_process)["']/,
      /import\(\s*[^)]/,
    ]) {
      expect(forbidden.test(text)).toBe(false);
    }
  });

  test.skipIf(skip)("ships declaration files for the public API", () => {
    const declarations = readFileSync(join(root, "dist", "index.d.ts"), "utf8");
    for (const symbol of [
      "CONTENT_INFO",
      "CONTENT_VERSION",
      "getCurriculum",
      "getLesson",
      "startLesson",
      "generateInstance",
      "isGoalSatisfied",
      "ContentError",
    ]) {
      expect(declarations).toContain(symbol);
    }
  });
});
