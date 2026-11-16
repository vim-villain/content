/** Structural bounds from ARCHITECTURE.md §4.1. */
export const LIMITS = Object.freeze({
  maxLinesPerBuffer: 12,
  maxCodePointsPerLine: 100,
  maxCodePointsPerBuffer: 600,
  maxOpsPerTemplate: 32,
  maxPicksPerTemplate: 32,
  maxItemsPerPick: 8,
  maxPoolSize: 512,
  maxStringFactLength: 100,
  maxBufferFactCount: 64,
  maxAllowedKeys: 64,
  maxSolutionKeys: 64,
  maxPar: 64,
});
