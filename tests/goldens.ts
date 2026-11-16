/**
 * Deterministic generation goldens for the seed curriculum.
 *
 * Update with `bun run test:update` only when a content change is intentional;
 * the diff is part of the review.
 */
export interface Golden {
  readonly templateId: string;
  readonly seed: string;
  readonly buffer: readonly string[];
  readonly cursor: { readonly line: number; readonly col: number };
  readonly goal:
    | { readonly kind: "cursor"; readonly cursor: { readonly line: number; readonly col: number } }
    | { readonly kind: "buffer"; readonly buffer: readonly string[] };
  readonly par: number;
}

export const GOLDENS: readonly Golden[] = [
  {
    templateId: "template.change-word.cw",
    seed: "0000000000000001",
    buffer: ["bravo charlie alpha"],
    cursor: { line: 0, col: 6 },
    goal: { kind: "buffer", buffer: ["bravo done alpha"] },
    par: 7,
  },
  {
    templateId: "template.change-word.cw",
    seed: "0000000000000002",
    buffer: ["ninja kilo salsa"],
    cursor: { line: 0, col: 6 },
    goal: { kind: "buffer", buffer: ["ninja done salsa"] },
    par: 7,
  },
  {
    templateId: "template.delete-word.dw",
    seed: "0000000000000001",
    buffer: ["salsa tiger foxtrot"],
    cursor: { line: 0, col: 6 },
    goal: { kind: "buffer", buffer: ["salsa foxtrot"] },
    par: 2,
  },
  {
    templateId: "template.delete-word.dw",
    seed: "0000000000000002",
    buffer: ["hotel zebra tiger"],
    cursor: { line: 0, col: 6 },
    goal: { kind: "buffer", buffer: ["hotel tiger"] },
    par: 2,
  },
  {
    templateId: "template.insert-basic.insert",
    seed: "0000000000000001",
    buffer: ["foxtrot whale"],
    cursor: { line: 0, col: 8 },
    goal: { kind: "buffer", buffer: ["foxtrot done whale"] },
    par: 7,
  },
  {
    templateId: "template.insert-basic.insert",
    seed: "0000000000000002",
    buffer: ["bravo otter"],
    cursor: { line: 0, col: 6 },
    goal: { kind: "buffer", buffer: ["bravo done otter"] },
    par: 7,
  },
  {
    templateId: "template.word-forward.basic",
    seed: "0000000000000001",
    buffer: ["river union tiger"],
    cursor: { line: 0, col: 0 },
    goal: { kind: "cursor", cursor: { line: 0, col: 12 } },
    par: 2,
  },
  {
    templateId: "template.word-forward.basic",
    seed: "0000000000000002",
    buffer: ["otter zebra queen"],
    cursor: { line: 0, col: 0 },
    goal: { kind: "cursor", cursor: { line: 0, col: 12 } },
    par: 2,
  },
];
