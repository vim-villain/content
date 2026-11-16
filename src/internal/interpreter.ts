import type {
  BufferRef,
  CompiledCursor,
  CompiledOp,
  CompiledPart,
  CompiledTemplate,
  SpanRef,
} from "./data.js";

/** Internal generation invariant violation. Caught and rethrown as GENERATION_FAILED. */
export class GenerationInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationInvariantError";
  }
}

export interface PickFact {
  kind: "pick";
  items: string[];
}

export interface Span {
  start: number;
  end: number;
}

export interface LineFact {
  kind: "line";
  text: string;
  spans: Map<string, Span>;
}

export interface BufferFact {
  kind: "buffer";
  lines: string[];
}

export type Fact = PickFact | LineFact | BufferFact;

export interface FactTable {
  facts: Map<string, Fact>;
  /** Fact name of every buffer op, in execution order. */
  bufferNames: string[];
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * Execute a compiled template's ops with the supplied PRNG. Pure and bounded:
 * at most 32 ops, 8 items per pick, 12 lines per buffer.
 */
export function executeTemplate(
  template: CompiledTemplate,
  nextUint32: () => number,
): FactTable {
  const facts = new Map<string, Fact>();
  const bufferNames: string[] = [];

  for (const op of template.ops) {
    if (facts.has(op.name)) {
      throw new GenerationInvariantError(`duplicate fact "${op.name}"`);
    }

    if (op.op === "pick") {
      facts.set(op.name, { kind: "pick", items: pickItems(op, nextUint32) });
      continue;
    }

    if (op.op === "line") {
      facts.set(op.name, buildLine(op.name, op.parts, facts));
      continue;
    }

    const lines: string[] = [];
    for (const entry of op.lines) {
      if (entry.kind === "text") {
        lines.push(entry.text);
      } else {
        const fact = facts.get(entry.name);
        if (fact === undefined || fact.kind !== "line") {
          throw new GenerationInvariantError(
            `buffer "${op.name}" references unknown line "${entry.name}"`,
          );
        }
        lines.push(fact.text);
      }
    }
    facts.set(op.name, { kind: "buffer", lines });
    bufferNames.push(op.name);
  }

  return { facts, bufferNames };
}

function pickItems(
  op: Extract<CompiledOp, { op: "pick" }>,
  nextUint32: () => number,
): string[] {
  const items = op.items.slice();
  const n = items.length;
  if (n === 0) {
    throw new GenerationInvariantError(`pool for "${op.name}" is empty`);
  }

  const taken: string[] = [];
  if (op.unique) {
    if (op.count > n) {
      throw new GenerationInvariantError(
        `pick "${op.name}" needs ${op.count} unique items but pool has ${n}`,
      );
    }
    for (let i = 0; i < op.count; i++) {
      const j = i + (nextUint32() % (n - i));
      const swap = items[i] as string;
      items[i] = items[j] as string;
      items[j] = swap;
      taken.push(items[i] as string);
    }
  } else {
    for (let i = 0; i < op.count; i++) {
      const j = nextUint32() % n;
      taken.push(items[j] as string);
    }
  }
  return taken;
}

function buildLine(
  name: string,
  parts: readonly CompiledPart[],
  facts: Map<string, Fact>,
): LineFact {
  const chunks: string[] = [];
  const spans = new Map<string, Span>();
  let cursor = 0;

  for (const part of parts) {
    let text: string;
    if (part.kind === "text") {
      text = part.text;
    } else if (part.kind === "pick") {
      const fact = facts.get(part.name);
      if (fact === undefined || fact.kind !== "pick") {
        throw new GenerationInvariantError(
          `line "${name}" references non-pick fact "${part.name}"`,
        );
      }
      const item = fact.items[part.index];
      if (item === undefined) {
        throw new GenerationInvariantError(
          `pick "${part.name}" has no index ${part.index}`,
        );
      }
      text = item;
    } else {
      const fact = facts.get(part.name);
      if (fact === undefined || fact.kind !== "line") {
        throw new GenerationInvariantError(
          `line "${name}" references non-line fact "${part.name}"`,
        );
      }
      text = fact.text;
    }

    const length = codePointLength(text);
    const span = part.as;
    if (span !== undefined) {
      if (length === 0) {
        throw new GenerationInvariantError(
          `line "${name}" names an empty span "${span}"`,
        );
      }
      if (spans.has(span)) {
        throw new GenerationInvariantError(
          `line "${name}" has duplicate span "${span}"`,
        );
      }
      spans.set(span, { start: cursor, end: cursor + length });
    }

    chunks.push(text);
    cursor += length;
  }

  return { kind: "line", text: chunks.join(""), spans };
}

/** Resolve a buffer reference. Returns a fresh array. */
export function resolveBuffer(ref: BufferRef, facts: Map<string, Fact>): string[] {
  if ("lit" in ref) {
    return ref.lit.slice();
  }
  const fact = facts.get(ref.ref);
  if (fact === undefined || fact.kind !== "buffer") {
    throw new GenerationInvariantError(`unknown buffer fact "${ref.ref}"`);
  }
  return fact.lines.slice();
}

export interface ResolvedCursor {
  line: number;
  col: number;
}

/** Resolve a cursor spec against the fact table and a concrete buffer. */
export function resolveCursor(
  spec: CompiledCursor,
  facts: Map<string, Fact>,
  buffer: readonly string[],
): ResolvedCursor {
  const span = spec.at;
  let base: number;
  if (span !== undefined) {
    base = spanStart(span, facts) + (spec.edge === "last" ? -1 : 0);
    if (spec.edge === "last" && spanIsEmpty(span, facts)) {
      throw new GenerationInvariantError(
        `cursor edge "last" on empty span "${span.fact}.${span.span}"`,
      );
    }
  } else if (spec.col !== undefined) {
    base = spec.col;
  } else {
    throw new GenerationInvariantError("cursor has neither col nor at");
  }

  const line = spec.line;
  const col = base + spec.offset;
  if (!Number.isInteger(line) || line < 0 || line >= buffer.length) {
    throw new GenerationInvariantError(`cursor line ${line} is out of bounds`);
  }
  const lineText = buffer[line] as string;
  const length = codePointLength(lineText);
  if (length === 0) {
    if (col !== 0) {
      throw new GenerationInvariantError(
        `cursor col ${col} is invalid on empty line ${line}`,
      );
    }
  } else if (!Number.isInteger(col) || col < 0 || col >= length) {
    throw new GenerationInvariantError(
      `cursor col ${col} is out of bounds on line ${line}`,
    );
  }
  return { line, col };
}

function spanStart(ref: SpanRef, facts: Map<string, Fact>): number {
  return lookupSpan(ref, facts).start;
}

function spanIsEmpty(ref: SpanRef, facts: Map<string, Fact>): boolean {
  const span = lookupSpan(ref, facts);
  return span.start === span.end;
}

function lookupSpan(ref: SpanRef, facts: Map<string, Fact>): Span {
  const fact = facts.get(ref.fact);
  if (fact === undefined || fact.kind !== "line") {
    throw new GenerationInvariantError(`unknown line fact "${ref.fact}"`);
  }
  const span = fact.spans.get(ref.span);
  if (span === undefined) {
    throw new GenerationInvariantError(
      `line fact "${ref.fact}" has no span "${ref.span}"`,
    );
  }
  return span;
}
