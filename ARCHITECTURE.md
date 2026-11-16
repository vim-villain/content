# vim-villain/content — Architecture

Status: accepted for implementation · Date: 2026-11-17

The public, MIT-licensed curriculum repository for vim-villain: declarative lessons,
deterministic challenge generation, and the compatibility metadata the API needs to
serve and validate attempts. This document is the design of record for the `content`
repo. It is an ADR log first and a map second; implementation detail belongs in the
repo's code, tests, and `CONTRIBUTING.md`.

`app/ARCHITECTURE.md` is the settled system design and is authoritative for the
product, the API, persistence, validation, and deployment. This document does not
redefine those contracts. It fills in the content-side design that the app document
leaves to this repo. A genuine conflict with `app/ARCHITECTURE.md` is a stop-work
condition, not something to resolve silently here.

Normative keywords (`MUST`, `SHOULD`, `MAY`) are used in the RFC 2119 sense. Numbers
that are product policy rather than invariants are marked as defaults and are
revisit-able.

---

## 1. Scope

### 1.1 What this repo owns

- The curriculum graph: groups, skills, lessons, ordering, prerequisites, and
  presentation metadata.
- Exercise prose: lesson summaries, instructions, hints, and key legends.
- Templates: challenge type, initial buffer and cursor, goal, allowed-key set,
  reference solution, par, and engine requirements.
- The deterministic generator: the declarative template language, its interpreter,
  the PRNG, canonical serialization, and generation bounds.
- Content identity: immutable IDs, slug policy, the active/draft/retired registry,
  content semver, and the content build fingerprint.
- Content correctness: replaying every reference solution against every supported
  engine version, proving goal satisfaction and par equality, and locking generated
  instances with golden tests.
- Content-side compatibility: the engine peer range, the exact tested engine list,
  and the metadata the app uses for its boot check.

### 1.2 What this repo does not own

- HTTP, sessions, players, attempts, rate limits, or persistence. The app owns them.
- Seed selection. The app chooses a cryptographically random seed and stores it.
- Key-log replay orchestration. The app replays; content supplies the instance and
  the goal predicate.
- Allowed-key *enforcement*. Content declares the set; the app rejects attempts
  containing a key outside it, as required by `app/ARCHITECTURE.md`.
- The engine's state transition rules, token vocabulary, or Neovim conformance.
- A client UI, a general-purpose content management system, or runtime authoring.
- Localization, non-ASCII curriculum text, images, audio, or adaptive difficulty in
  M1. See §5.8 and open question O8.

### 1.3 Terms

| Term | Meaning |
|---|---|
| **Skill** | A capability learners master, e.g. `skill.motion.word`. Progress is keyed by skill ID. |
| **Lesson** | A teachable unit with prose and one or more templates. Resolved by slug. |
| **Template** | A deterministic challenge family. Its *instance* is generated from `(template_id, seed, content_version)`. |
| **Instance** | The concrete buffer, cursor, goal, allowed keys, and par returned to the app. |
| **Seed** | An opaque, server-chosen string. Content never chooses it. |
| **Par** | The keystroke count of the reference solution. A benchmark, not a proven optimum. |
| **Allowed keys** | The token set the app permits for an attempt. A safety boundary, not a forced path. |
| **Content version** | The published package semver, recorded in attempts for version affinity. |
| **Build ID** | A SHA-256 fingerprint of the compiled runtime content, for release integrity. |
| **Tested engine versions** | The exact `@vim-villain/engine` versions this content release was validated against. |

---

## 2. Repository and package shape

### 2.1 Independent repo and release identity

`vim-villain/content` is an independent git repository with its own remote, CI, and
release. It MUST NOT import another repo's source by relative path. Its committed
manifest and CI MUST use registry versions of `@vim-villain/engine`, never
`workspace:*` or `file:` links. The local workspace root is a development
convenience, not a published artifact.

| Property | Value |
|---|---|
| Repository | `vim-villain/content` |
| License | MIT |
| Package | `@vim-villain/content` |
| Module format | ESM-only |
| Runtime | Bun on the server; universal ESM with no Node built-ins |
| Runtime dependencies | none |
| Peer dependency | `@vim-villain/engine` (contract and type compatibility) |
| Build-time dependencies | TypeScript, `yaml`, `zod`, a semver parser |
| Test runner | `bun test` |
| Publish access | public, with npm provenance |

The first release is `0.1.0`. Content versions are independent of engine versions.
The first publish declares the engine version pinned in `compatibility.yaml` at
release time; concrete engine versions used in examples here are illustrative of the
drafting baseline, not a compatibility promise. §7.6 is the normative rule.

### 2.2 Runtime dependencies and peer

The published package MUST have **zero runtime dependencies**. In particular:

- No YAML parser at runtime.
- No filesystem, path, crypto, or Node built-ins at runtime.
- No Zod at runtime; schemas are build-time only.
- No `@vim-villain/engine` value import at runtime. Engine imports are type-only and
  erased; the peer dependency exists to declare and enforce compatibility, not to
  inject engine code into the content bundle.

`@vim-villain/engine` is a peer dependency because content's public types use the
engine's `Position`/`State` shapes and because every generated goal is interpreted
by that engine. The peer range is narrow and tested (§7.6). The app already installs
the engine, so the peer is satisfied at runtime.

Keeping the runtime dependency-free is a supply-chain property, not an optimization:
the app can audit a small data-plus-interpreter package and does not inherit a
transitive dependency tree from content.

### 2.3 Universal runtime, not server-only

The runtime is **browser-safe**: it uses only ECMAScript, has no DOM or Node
dependencies, and can be bundled for a browser. The app's client MUST NOT value-import
it in M1; the client imports types only (§3.8).

Rationale:

- The generator is pure data plus integer/string operations. There is no technical
  reason to require Node. Making the package universal costs almost nothing and
  prevents accidental `fs`/`path` coupling from creeping in.
- A future offline-practice or client-preview feature could reuse generation without
  a second package. That is not a commitment, only an option preserved cheaply.
- The curriculum and prose are not secret: the repo is MIT and public. Server-only
  would not hide them. The start response already reveals each instance.
- A universal package does not force the app to ship it to the browser. The app's
  client build rule is the control (§3.8).

Alternative rejected: a server-only package with Node APIs. It would simplify nothing
today and would foreclose browser reuse. If content ever needs a privileged operation
(file-backed authoring, signing), that belongs in a build tool, not the runtime.

### 2.4 YAML is authoring-only; the runtime is precompiled

YAML is the human-authoring format. It is never parsed by the published package.

Build pipeline:

1. Discover `content/**/*.yaml` in a deterministic (sorted) order.
2. Parse with a strict YAML 1.2 core-schema parser: duplicate keys rejected,
   anchors/aliases rejected, custom tags rejected, one document per file.
3. Validate with Zod schemas and cross-file graph checks.
4. Resolve pools, presets, and constraints into explicit data.
5. Emit a frozen runtime data module containing **active** content only.
6. Emit a CI-only validation artifact containing reference solutions and engine
   ranges.
7. Bundle the runtime into a single ESM file and emit declarations.

The runtime data module is generated into a gitignored `src/generated/` directory so
typechecking sees it. The committed source of truth is YAML plus the registry. A
clean checkout runs codegen before typecheck, test, or build.

Why precompile:

- No runtime filesystem access, no YAML parser, no path resolution, no cold-start
  file I/O.
- Draft and retired content cannot leak through a missed runtime filter: it is not in
  the generated data at all.
- Reference solutions cannot leak through the start response: they are not in the
  published artifact at all (§2.5).
- The generated bundle is deterministic and hashable.

### 2.5 What is published, precompiled, and private

| Artifact | Location | In npm tarball? | Purpose |
|---|---|---|---|
| Public runtime | `dist/index.js` + `dist/index.d.ts` | Yes | The stable API. |
| Active content data | bundled into `dist/index.js` | Yes | Curriculum, prose, templates, goals, allowed sets, par. |
| Reference solutions | `content/**` YAML + `tests/generated/validation.ts` | **No** | CI replay only. |
| Draft/retired content | `content/**` YAML + `registry/ids.yaml` | No | Authoring and history. |
| Pools/presets | `content/pools`, `content/presets` | No (resolved into templates) | Authoring. |
| Registry | `registry/ids.yaml` | No | Immutable identity record. |
| Build-time schemas | `src/schema.ts` | No | Validation. |
| Tests, fixtures, goldens | `tests/**` | No | CI. |
| Build scripts | `scripts/**` | No | CI and local development. |

The published tarball MUST contain `dist`, `README.md`, `LICENSE`, `CHANGELOG.md`, and
`ARCHITECTURE.md` only. It MUST NOT contain YAML, the registry, tests, scripts, or the
validation artifact.

**Reference solutions are deliberately absent from the published package.** They are
public in the git repo, so this is not secrecy; it is a guarantee that the app cannot
accidentally serialize them into a start response. A future "show solution" feature
would need a new decision and an explicit API, not an accidental leak.

### 2.6 Proposed file tree

```
content/
├── ARCHITECTURE.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── SECURITY.md
├── package.json
├── tsconfig.json                 # runtime source: ES2022, no DOM, no Node types
├── tsconfig.scripts.json         # build/test scripts: Bun/Node types allowed
├── bun.lock
├── .editorconfig
├── .gitattributes                # * text=auto eol=lf
├── .gitignore
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── compatibility.yml     # matrix over tested engine versions
│       ├── nightly.yml           # external link check, long enumeration
│       └── release.yml           # tag-triggered publish + post-publish smoke
├── registry/
│   └── ids.yaml                  # every skill/lesson/template ID ever allocated
├── content/
│   ├── groups.yaml
│   ├── compatibility.yaml        # engineRange + tested versions
│   ├── skills/
│   │   ├── motion/
│   │   │   ├── char.yaml
│   │   │   └── word.yaml
│   │   └── ...
│   ├── lessons/
│   │   ├── motion/
│   │   │   ├── char-moves/
│   │   │   │   ├── lesson.yaml
│   │   │   │   └── templates/
│   │   │   │       ├── horizontal.yaml
│   │   │   │       └── vertical.yaml
│   │   │   └── word-forward/
│   │   │       ├── lesson.yaml
│   │   │       └── templates/
│   │   │           └── basic.yaml
│   │   └── ...
│   ├── pools/
│   │   └── words/
│   │       ├── common.yaml
│   │       └── big.yaml
│   └── presets/
│       └── allowed-keys.yaml
├── src/
│   ├── index.ts                  # stable public exports only
│   ├── types.ts                  # public types
│   ├── api.ts                    # curriculum/lookup/start functions
│   ├── curriculum.ts             # ordering, prerequisite closure, views
│   ├── generate.ts               # generation entry points
│   ├── judge.ts                  # isGoalSatisfied
│   ├── prng.ts                   # pinned hash32 + mulberry32
│   ├── errors.ts                 # ContentError
│   ├── limits.ts                 # structural bounds
│   ├── schema.ts                 # build-time Zod schemas (not bundled)
│   ├── internal/
│   │   ├── interpreter.ts        # pick/line/buffer ops
│   │   ├── resolve.ts            # facts, spans, cursor resolution
│   │   └── canonical.ts          # canonical JSON + hashing helpers
│   └── generated/
│       ├── runtime.ts            # gitignored, no solutions
│       └── validation.ts         # gitignored, CI-only, includes solutions
├── scripts/
│   ├── codegen.ts
│   ├── build.ts
│   ├── validate.ts
│   ├── replay.ts
│   ├── enumerate.ts
│   ├── pack-check.ts
│   └── update-golden.ts
├── tests/
│   ├── unit/
│   ├── validation/
│   ├── replay/
│   ├── determinism/
│   ├── fixtures/
│   │   ├── seeds.json
│   │   ├── templates/<template-id>/<seed>.instance.json
│   │   ├── curriculum.json
│   │   ├── lessons/<slug>.json
│   │   └── invalid/
│   └── golden/
│       ├── instance-hashes.json
│       └── public-api.json
└── dist/                         # build output, gitignored
```

Representative files only; the tree is not an exhaustive list of lessons.

### 2.7 Package manifest

```json
{
  "name": "@vim-villain/content",
  "version": "0.1.0",
  "description": "Deterministic lessons and challenge templates for vim-villain.",
  "license": "MIT",
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE",
    "CHANGELOG.md",
    "ARCHITECTURE.md"
  ],
  "peerDependencies": {
    "@vim-villain/engine": ">=0.4.0 <0.5.0"
  },
  "dependencies": {},
  "devDependencies": {
    "@vim-villain/engine": "0.4.0",
    "typescript": "^5.9.3",
    "yaml": "^2.8.0",
    "zod": "^4.0.0",
    "semver": "^7.6.0"
  },
  "scripts": {
    "codegen": "bun run scripts/codegen.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.scripts.json --noEmit",
    "build": "bun run codegen && bun run scripts/build.ts",
    "test": "bun run codegen && bun test",
    "test:compat": "bun run scripts/replay.ts --matrix",
    "test:update": "bun run scripts/update-golden.ts",
    "pack:check": "bun run scripts/pack-check.ts"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

`package.json`'s peer range MUST equal `content/compatibility.yaml`'s `engineRange`.
CI checks this. The dev dependency is the lowest tested engine version, so local tests
catch floor-version issues; the compatibility job covers the rest.

### 2.8 Build pipeline

```
YAML + registry
      │
      ▼
parse (strict, no aliases) ──► schema validation ──► graph/registry validation
      │
      ▼
resolve pools, presets, constraints, bounds
      │
      ├──► src/generated/runtime.ts      (active content, no solutions)
      └──► tests/generated/validation.ts (active content + solutions + engine ranges)
      │
      ▼
bun build src/index.ts ──► dist/index.js
tsc --emitDeclarationOnly ──► dist/index.d.ts
      │
      ▼
build ID = sha256(canonicalJson(runtime payload + generator/schema versions))
```

The build has no timestamps, no environment-dependent values, and no filesystem-order
dependence. The same inputs produce byte-identical `dist/index.js` and the same build
ID on every machine. CI builds twice on a clean checkout and compares.

---

## 3. Public API

### 3.1 Design rules

1. **Small surface.** The app calls a handful of pure functions. Anything the app
   does not need is internal.
2. **Stable means semver-protected.** Everything exported from `src/index.ts` is
   stable API. Deep imports are blocked by `exports` and are not supported.
3. **Lookups return `null`; generation throws typed errors.** A missing lesson is a
   normal condition (404), not an exception. A bad seed or unknown template in a
   generation call is a programming/configuration error worth a typed throw.
4. **No reference keys.** No public result contains a solution, pool, or template
   lookup that would reveal one.
5. **Immutable results.** Compiled data is deeply frozen. Generated instances are
   fresh frozen objects. The app may serialize them but must not mutate them.
6. **No engine-version parameter.** The installed package version is the content
   version. The app MUST NOT call content with an engine outside the tested matrix;
   the boot check enforces that. Content does not branch on engine version at runtime.

### 3.2 Constants and content info

```ts
export const CONTENT_VERSION: string;          // package.json version
export const CONTENT_BUILD_ID: string;         // 64-char lowercase SHA-256
export const CONTENT_SCHEMA_VERSION: number;   // instance/schema version, starts at 1
export const GENERATOR_VERSION: number;        // interpreter behavior version, starts at 1
export const ENGINE_RANGE: string;             // npm semver range, e.g. ">=0.4.0 <0.5.0"
export const TESTED_ENGINE_VERSIONS: readonly string[]; // exact, ascending

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

export const CONTENT_INFO: ContentInfo;
```

`CONTENT_INFO` is the single object the app logs at boot and checks against its
supported matrix. `CONTENT_VERSION` and `CONTENT_BUILD_ID` are also exported
individually because they appear in release notes, metrics, and error logs.

### 3.3 Public types

```ts
import type { Position } from "@vim-villain/engine";

export type SkillId = string;       // "skill.<group>.<name>"
export type LessonId = string;      // "lesson.<slug>"
export type TemplateId = string;    // "template.<lesson-slug>.<variant>"
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
  readonly skillIds: readonly SkillId[];             // primary skill first
  readonly prerequisiteSkillIds: readonly SkillId[]; // effective closure, minus own skills
  readonly challengeTypes: readonly ChallengeType[]; // union of active templates
  readonly tags: readonly string[];
}

export interface LessonDetail extends LessonSummary {
  readonly instructions: string;   // plain text paragraphs, no Markdown/HTML
  readonly hints: readonly string[]; // progressive, may name a command
  readonly keyLegend: readonly string[]; // display-only tokens
  readonly contentVersion: string;
  readonly schemaVersion: number;
}

export interface CurriculumGroup {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly order: number;
  readonly lessons: readonly LessonSummary[]; // sorted by (order, id)
}

export interface Curriculum {
  readonly contentVersion: string;
  readonly schemaVersion: number;
  readonly groups: readonly CurriculumGroup[]; // sorted by (order, id)
  readonly skills: readonly SkillSummary[];    // sorted by group, then skill order
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
  readonly allowedKeys: readonly string[]; // sorted, unique
  readonly par: number;
}

export interface JudgeState {
  readonly buffer: readonly string[];
  readonly cursor: Position;
}
```

Notes:

- `Position` is the engine's zero-based line and **Unicode code-point column**. Content
  uses the same convention everywhere. Content buffers are ASCII-only in M1, so code
  points, UTF-16 units, and bytes coincide for authored text, but the API type and
  interpreter MUST remain code-point-correct (§4.1).
- `LessonSummary.group` is a group ID string, not a closed union. Groups are data
  (`content/groups.yaml`), so adding a group does not require an app type change.
- `prerequisiteSkillIds` is derived: the union of the prerequisites of the lesson's
  skills, minus the lesson's own skills, deduplicated and sorted by curriculum order.
- `GeneratedInstance` has no `mode` field. Every M1 template starts in normal mode.
  If insert-start drills are added later, an optional `mode` field is additive.
- `GeneratedInstance` has no `buildId`. The app reads `CONTENT_INFO.buildId` at boot;
  attempts store the content version, not the build ID.

### 3.4 Functions

```ts
/** The full ordered curriculum. Never throws; returns a frozen, cached object. */
export function getCurriculum(): Curriculum;

/** Resolve a lesson by canonical slug. Returns null for unknown/retired slugs. */
export function getLesson(slug: string): LessonDetail | null;

/** Resolve a lesson by immutable ID. Returns null for unknown/retired IDs. */
export function getLessonById(id: LessonId): LessonDetail | null;

/** Resolve a skill by immutable ID. Returns null for unknown/retired skills. */
export function getSkill(id: SkillId): SkillDetail | null;

/** All active skills, ordered. Never throws. */
export function getSkills(): readonly SkillDetail[];

/**
 * Resolve a lesson slug, select an active template deterministically from the seed,
 * generate the instance, and return it with the lesson and template IDs.
 *
 * Throws ContentError with code UNKNOWN_LESSON, INVALID_SEED, NO_ACTIVE_TEMPLATE,
 * or GENERATION_FAILED.
 */
export function startLesson(slug: LessonSlug, seed: string): GeneratedInstance;

/**
 * Generate an instance for an exact template ID. Used by tests and by future
 * racing rooms that pin a template. Throws UNKNOWN_TEMPLATE, INVALID_SEED, or
 * GENERATION_FAILED.
 */
export function generateInstance(templateId: TemplateId, seed: string): GeneratedInstance;

/**
 * The single source of truth for goal semantics. Exact cursor equality for
 * move-to-target; exact line-array equality for edit-to-match. Never throws.
 */
export function isGoalSatisfied(goal: Goal, state: JudgeState): boolean;

/** Cross-realm-safe guard for ContentError. */
export function isContentError(error: unknown): error is ContentError;
```

The app's start flow is:

```ts
const instance = startLesson(slug, serverChosenSeed);
const state = initialState({ buffer: instance.buffer, cursor: instance.cursor });
```

The app's submit flow regenerates the instance with the stored seed and template ID,
replays the key log with the engine, and calls `isGoalSatisfied` on the final state.
The app MUST NOT call `getLesson` to reconstruct the instance at submit time: lesson
composition can change, and the attempt is keyed by `template_id` and versions.

### 3.5 Errors

```ts
export type ContentErrorCode =
  | "UNKNOWN_LESSON"
  | "UNKNOWN_TEMPLATE"
  | "INVALID_SEED"
  | "NO_ACTIVE_TEMPLATE"
  | "GENERATION_FAILED";

export class ContentError extends Error {
  readonly code: ContentErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}
```

| Situation | Behavior | App mapping |
|---|---|---|
| Unknown or retired slug in `startLesson` | throw `UNKNOWN_LESSON` | 404 |
| Unknown or retired template in `generateInstance` | throw `UNKNOWN_TEMPLATE` | 404/410 |
| Seed not 16–64 lowercase hex chars | throw `INVALID_SEED` | 500 (server chose it) |
| Active lesson has no active template | throw `NO_ACTIVE_TEMPLATE` | 500, alert |
| Compiled invariant violated at runtime | throw `GENERATION_FAILED` | 500, alert |
| Unknown slug in `getLesson` | return `null` | 404 |
| Unknown ID in `getLessonById`/`getSkill` | return `null` | 404 |
| Any input to `isGoalSatisfied` | return `false` on malformed/unknown goal | 500 only via caller |

`ContentError.details` MAY include `lessonId`, `lessonSlug`, `templateId`, `seed`, and
a short `reason`. It MUST NOT include reference keys, pool contents, or full solution
data. Error messages are for logs, not for end users; the app owns user-facing copy.

**Seed format.** The seed MUST match `^[0-9a-f]{16,64}$` exactly. Lowercase hex only;
no trimming or normalization. The app SHOULD generate 16 random bytes and encode them
as 32 lowercase hex characters. The seed is opaque to content and is not a secret: it
is stored in the attempt and may appear in logs.

**Slug format.** Exact, case-sensitive lookup. No case folding, no fuzzy matching, no
URL decoding inside content. The app passes the decoded path segment.

### 3.6 Stable versus internal API

| Surface | Status | Examples |
|---|---|---|
| `src/index.ts` exports | Stable, semver-protected | `getCurriculum`, `startLesson`, `isGoalSatisfied`, `ContentError` |
| `package.json` `exports["."]` | Stable | The only public entry point |
| `src/internal/**` | Internal | interpreter, fact resolution, canonical JSON |
| `src/generated/**` | Internal | compiled runtime/validation data |
| `content/**`, `registry/**`, `scripts/**`, `tests/**` | Repo-only | authoring, CI |
| `dist/internal/**` | Not exported | blocked by `exports`; no support |

The package MUST NOT expose subpath exports. A consumer that deep-imports internal
files is unsupported and may break in any release.

### 3.7 What is deliberately not exposed

- Reference solutions, solution segments, or a `getSolution` function.
- Template lookup, template lists, template titles/descriptions, or per-template
  engine ranges.
- Pools, pool contents, constraint resolution details, or which words were picked.
- The registry, draft content, retired content, or build-time schemas.
- Internal IDs for groups/pools/presets.
- A server-side "generate a challenge from arbitrary JSON" API. Content generates
  only from compiled templates.

Template IDs appear only in `GeneratedInstance` and in attempts, because the app must
store and replay the exact template. They are not a lookup surface.

### 3.8 Client rule

The client MAY `import type { Curriculum, LessonDetail, GeneratedInstance, Goal }`
from `@vim-villain/content`. It MUST NOT value-import the package in M1. The app's
client build MUST treat a value import as an error (lint rule or bundler check). The
client gets curriculum and lesson data from the API, not from the package. This keeps
lesson prose, draft gating, and the full content dataset out of the browser bundle and
preserves the server as the source of truth.

`@vim-villain/content`'s public types reference `Position` from
`@vim-villain/engine`. The client already installs the engine for its renderer, so
type-only usage adds no runtime dependency.

---

## 4. Content schema

### 4.1 Conventions

| Rule | Value |
|---|---|
| Encoding | UTF-8, LF, no BOM |
| YAML | 1.2 core schema; one document per file; no anchors/aliases; no custom tags; duplicate keys rejected |
| Indentation | 2 spaces; tabs forbidden anywhere |
| Character set | Printable ASCII `0x20–0x7E` for all authored values, plus `\n` in prose fields |
| Buffer text | Printable ASCII, no tabs, no `\n`; empty lines are `""` |
| Columns | Zero-based Unicode code-point indices, matching engine `Position` |
| IDs | Lowercase ASCII, dot-separated kebab segments (§7.1) |
| Slugs | Lowercase ASCII kebab, 3–40 chars, globally unique, permanent once active |
| File size | ≤ 64 KiB per YAML file |
| Total content | ≤ 2 MiB of YAML (excluding tests) |
| Prose | Plain text, no Markdown, no HTML, no URLs in lesson prose |
| Numbers | Integers only; no floats anywhere in content |

**ASCII is a hard rule in M1.** The engine's word class is fixed ASCII
(`A-Za-z0-9_`); all other non-blanks are punctuation. Allowing non-ASCII buffer text
would make lessons behave differently from what learners expect from a word motion and
would complicate column arithmetic. The interpreter still counts code points, not
UTF-16 units, so a future non-ASCII content decision is a schema/policy change rather
than an interpreter rewrite. See O8.

**Limits.** These are structural bounds, not suggestions:

| Limit | Value |
|---|---|
| Lines per buffer (initial or goal) | 1–12 |
| Code points per line | 0–100 |
| Total code points per buffer | ≤ 600 |
| Generate ops per template | 1–32 |
| Picks per template | 1–32 items total |
| Items per pick | 1–8 |
| Pool size after constraints | 1–512 |
| String fact length | 0–100 code points |
| Buffer/goal fact count | ≤ 64 |
| Allowed keys per template | 1–64 |
| Solution keys | 1–64 |
| Par | 1–64 |

The app's attempt cap is ~2,000 keys, so content's 64-key ceiling is comfortably
inside the server's replay budget. The limits keep generation O(ops + output) and make
abuse bounded.

### 4.2 Groups

`content/groups.yaml` is a top-level array. Groups are presentation buckets; they do
not affect identity.

```yaml
- id: movement
  title: Movement
  description: Move the cursor without changing text.
  order: 10
- id: insert
  title: Insert
  description: Enter text and leave insert mode cleanly.
  order: 20
- id: operators
  title: Operators
  description: Delete, change, and indent with operator plus motion.
  order: 30
- id: text-objects
  title: Text objects
  description: Act on words, quotes, brackets, and paragraphs.
  order: 40
- id: visual
  title: Visual mode
  description: Select first, then act.
  order: 50
- id: registers
  title: Registers
  description: Yank and paste with the unnamed register.
  order: 60
- id: history
  title: History
  description: Undo, redo, and repeat the last change.
  order: 70
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | kebab, unique, permanent; referenced by skills/lessons |
| `title` | string | yes | 2–40 ASCII |
| `description` | string | yes | 10–160 ASCII, one line |
| `order` | integer | yes | unique, 0–9999; ascending display order |

A group with no active lessons is omitted from `getCurriculum()`. M1 uses the seven
groups above; adding a group is a content minor.

### 4.3 Skills

Path: `content/skills/<namespace>/<name>.yaml` → ID `skill.<namespace>.<name>`.

The directory is the skill **namespace**, not the presentation group. Namespaces are
short topic segments (`motion`, `operator`, `textobject`, `register`, `history`) and are
part of the permanent ID. The `group` field is presentation metadata and may differ:
`skill.motion.word` belongs to the `movement` group.

```yaml
id: skill.motion.word
title: Word motions
group: movement
order: 20
summary: Move between words with w, b, and e.
description: |
  Word motions treat runs of letters, digits, and underscores as words.
  w moves to the next word start, b to the previous start, and e to the
  current or next word end.
prerequisites:
  - skill.motion.char
tags:
  - motion
  - word
status: active
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | `skill.<namespace>.<name>`; must equal path-derived ID |
| `title` | string | yes | 2–60 ASCII, one line |
| `group` | string | yes | presentation group; must exist in `groups.yaml`; may differ from the namespace |
| `order` | integer | yes | unique within group, 0–9999 |
| `summary` | string | yes | 10–160 ASCII, one line; used in lists |
| `description` | string | no | 0–1200 ASCII, plain text paragraphs |
| `prerequisites` | string[] | no | skill IDs; default `[]`; no self; must exist; graph must be acyclic |
| `tags` | string[] | no | 0–8 kebab tags, unique |
| `status` | enum | no | `active` (default), `draft`, `retired`; must match registry |

Rules:

- An active skill MUST have at least one active lesson. A draft skill MAY have none.
- An active skill's prerequisites MUST be active skills. A draft skill's
  prerequisites MAY be active or draft.
- Skill IDs are permanent once active. A skill's namespace is part of its ID; changing
  the namespace creates a new skill ID and retires the old one. The presentation group
  is metadata and may change without changing the skill ID. This is deliberate: a
  skill is a taxonomy node, not a presentation bucket.
- M1 does not retire skills. Retiring a skill would orphan `skill_progress` rows and
  needs a product decision. Retire lessons/templates instead; keep the skill
  resolvable.

### 4.4 Lessons

Path: `content/lessons/<group>/<slug>/lesson.yaml` → ID `lesson.<slug>`.
The `group` is metadata, not part of the ID: a lesson may be re-grouped without
breaking progress or attempt history.

```yaml
id: lesson.word-forward
slug: word-forward
title: Forward by word
group: movement
order: 20
difficulty: 1
skills:
  - skill.motion.word
summary: Jump to the start of the next word.
instructions: |
  Move the cursor to the start of the third word.

  Press w to jump forward one word. A count repeats the motion: 3w moves
  three words at once.
hints:
  - w moves to the start of the next word.
  - A count before w repeats it, so 3w moves three words.
keyLegend:
  - w
  - "3"
tags:
  - motion
  - word
status: active
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | `lesson.<slug>`; must equal `lesson.` + directory name |
| `slug` | string | yes | must equal directory name; globally unique; permanent once active |
| `title` | string | yes | 2–60 ASCII, one line |
| `group` | string | yes | must equal path group and exist; primary curriculum bucket |
| `order` | integer | yes | unique within group, 0–9999 |
| `difficulty` | integer | yes | 1–5 |
| `skills` | string[] | yes | 1–4 skill IDs; first is primary; must exist and be active for an active lesson |
| `summary` | string | yes | 10–160 ASCII, one line |
| `instructions` | string | yes | 20–1600 ASCII, plain text, ≤ 20 lines |
| `hints` | string[] | no | 0–5; each 5–240 ASCII, one line or short paragraph |
| `keyLegend` | string[] | no | 0–16 valid key tokens; display only; must be in the union of active templates' allowed keys |
| `tags` | string[] | no | 0–8 kebab tags |
| `status` | enum | no | `active` (default), `draft`, `retired`; must match registry |

Rules:

- `skills[0]`'s group MUST equal the lesson's `group`. Additional skills MAY come
  from other groups; this supports combined lessons (e.g. visual + operator).
- An active lesson MUST have at least one active template and all its skills MUST be
  active. A draft lesson's templates MUST be draft.
- Effective prerequisites are derived; lessons do not declare their own prerequisite
  list. M1 does not gate lessons behind prerequisites; the app may use the metadata
  for recommendation/order.
- Templates are discovered from the sibling `templates/` directory; the lesson does
  not list template IDs. The compiler enforces the relationship.
- The lesson's `challengeTypes` are the union of its active templates' types.
- `keyLegend` is not enforcement. It is the short list of keys the UI shows for the
  lesson. The start response's `allowedKeys` is enforcement.

### 4.5 Templates

Path: `content/lessons/<group>/<slug>/templates/<variant>.yaml` →
ID `template.<slug>.<variant>`.

Common fields:

```yaml
id: template.word-forward.basic
lesson: lesson.word-forward
order: 10
status: active
type: move-to-target
engine: ">=0.4.0 <0.5.0"
title: Third word start
description: Move from the first word to the start of the third word.
notes: |
  The solution is invariant because every generated line is three words
  separated by single spaces, and the goal is the start of the third span.
generate:
  - op: pick
    name: words
    pool: words.common
    count: 3
    unique: true
    constraints:
      length: { min: 3, max: 7 }
  - op: line
    name: line
    parts:
      - ref: words.0
        as: first
      - text: " "
      - ref: words.1
        as: second
      - text: " "
      - ref: words.2
        as: third
  - op: buffer
    name: buffer
    lines:
      - ref: line
initial:
  buffer: { ref: buffer }
  cursor: { line: 0, at: line.first, edge: start }
goal:
  kind: cursor
  cursor: { line: 0, at: line.third, edge: start }
allowed:
  preset: motion.word
solution:
  keys: ["w", "w"]
par: 2
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | `template.<lesson-slug>.<variant>`; must equal path-derived ID |
| `lesson` | string | yes | must equal `lesson.<slug>` for the parent directory |
| `order` | integer | yes | unique within lesson, 0–9999; template-selection order |
| `status` | enum | no | `active` (default), `draft`, `retired`; must match registry |
| `type` | enum | yes | `move-to-target` or `edit-to-match` |
| `engine` | string | yes | narrow semver range; all active tested versions must satisfy it (§7.6) |
| `title` | string | yes | 2–60 ASCII; author-facing, not published |
| `description` | string | no | 0–240 ASCII; author-facing review note |
| `notes` | string | no | 0–1200 ASCII; explains solution invariance; not published |
| `generate` | op[] | yes | 1–32 ops; see §4.6 |
| `initial` | object | yes | buffer + cursor; see §4.7 |
| `goal` | object | yes | cursor or buffer; must agree with `type` |
| `allowed` | preset/string[] | yes | see §4.8 |
| `solution` | object | yes | `{ keys: string[] }`, 1–64 tokens; reference path |
| `par` | integer | yes | 1–64; MUST equal `solution.keys.length` |

Rules:

- `move-to-target` ⇒ `goal.kind: "cursor"`; `edit-to-match` ⇒ `goal.kind: "buffer"`.
- Every solution token MUST be a valid engine token, MUST be in the resolved allowed
  set, and MUST be recognized at its step by every engine version in the template's
  range.
- The initial state MUST NOT already satisfy the goal for any generated instance.
- For `move-to-target`, the reference solution MUST NOT change the buffer and MUST
  end in normal mode. Every allowed token MUST be a motion/correction token per the
  content classification (§4.8).
- For `edit-to-match`, the reference solution MUST end in normal mode.
- Par is the reference length, not a maximum. A learner may submit fewer or more
  keys; the goal decides.
- A template's title/description/notes are compiled out of the runtime artifact.
  They exist for review and changelog quality.

### 4.6 Generation operations

There are exactly three ops. This is intentionally not a programming language.

#### `pick`

Choose items from a static pool.

```yaml
- op: pick
  name: words
  pool: words.common
  count: 3
  unique: true
  constraints:
    length: { min: 3, max: 7 }
    charset: ascii-lower
    forbidChars: "xz"
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `op` | `"pick"` | yes | literal |
| `name` | string | yes | unique fact name, `[a-z][a-z0-9_]{0,31}` |
| `pool` | string | yes | pool ID; must exist |
| `count` | integer | yes | 1–8 |
| `unique` | boolean | no | default `true`; without replacement |
| `constraints` | object | no | see below |

Constraints are evaluated **at build time** against the static pool. The compiler
resolves the filtered pool and inlines it into the compiled template. The runtime never
filters, never retries, and never fails because a constraint became unsatisfiable.

| Constraint | Type | Meaning |
|---|---|---|
| `length` | `{ min?: int, max?: int }` | code-point length bounds |
| `charset` | `"ascii-lower"` \| `"ascii-alnum"` \| `"ascii"` | allowed characters |
| `forbidChars` | string | none of these characters may appear |
| `requireChars` | string | all of these characters must appear |
| `uniqueChars` | boolean | all characters in the item must be distinct |
| `notIn` | string[] | exact items to exclude |

Pool kinds (declared in the pool file):

| Kind | Item rule | Use |
|---|---|---|
| `word` | `^[a-z]{2,12}$` | `w b e` word motions, operator words |
| `big-word` | printable ASCII, no spaces, 1–20 chars | `W B E` WORD motions |

The compiler MUST reject a template if the filtered pool has fewer than `count` items
when `unique: true`, or fewer than 1 item when `unique: false`.

#### `line`

Build one line from parts and record named spans.

```yaml
- op: line
  name: line
  parts:
    - ref: words.0
      as: first
    - text: " "
    - ref: words.1
      as: second
    - text: " "
    - ref: words.2
      as: third
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `op` | `"line"` | yes | literal |
| `name` | string | yes | unique fact name |
| `parts` | part[] | yes | 1–32 parts |

A part has exactly one of:

- `ref`: a pick element (`words.0`) or a line fact name. Pick elements are strings.
  A line-fact ref is allowed as text but its inner spans are not addressable in the
  new line; prefer pick elements.
- `text`: a literal string. `""` is allowed but a span on an empty part is invalid.

`as` is optional. If present, it names the span for cursor/goal references. Names MUST
be unique within the line. A span is `{ start, end }` in code points, with `end`
exclusive. The line's length is the sum of its parts. A part may be empty only if it
has no `as`.

#### `buffer`

Build a buffer (array of lines).

```yaml
- op: buffer
  name: buffer
  lines:
    - ref: line
    - text: ""
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `op` | `"buffer"` | yes | literal |
| `name` | string | yes | unique fact name |
| `lines` | line[] | yes | 1–12 lines |

A line entry has exactly one of `ref` (a line fact) or `text` (a literal line). The
buffer's line count is static for the template; variation is lexical, not structural.

**No other ops.** There is no `if`, `foreach`, `repeat`, `concat`, `slice`,
interpolation, arithmetic, case transform, or nested template. If a future lesson
needs structural variation, adding an op is a content schema/generator version
change, not an authoring workaround.

Refs are flat: `name` (string/line/buffer) or `name.<index>` (pick element). No nested
paths. The compiler validates every ref, index, type, and span at build time.

### 4.7 Initial state, cursor, and goal

```yaml
initial:
  buffer: { ref: buffer }        # or { lit: ["literal", "lines"] }
  cursor: { line: 0, at: line.first, edge: start }

goal:
  kind: cursor
  cursor: { line: 0, at: line.third, edge: start }
```

Cursor spec:

| Field | Type | Required | Rules |
|---|---|---|---|
| `line` | integer | yes | 0-based line index into the buffer |
| `col` | integer | one of `col`/`at` | 0-based code-point column |
| `at` | string | one of `col`/`at` | span ref `lineName.spanName` |
| `edge` | `"start"` \| `"last"` | no | default `start`; `last` = span.end − 1 |
| `offset` | integer | no | −16..16; added after edge; final position must be valid |

Rules:

- Exactly one of `col` or `at`.
- For `at`, the referenced line fact MUST be used at the cursor's `line` in the
  buffer. The compiler checks this statically; the runtime re-checks bounds.
- Normal-mode cursor invariants: `0 ≤ line < buffer.length`; if the line is non-empty,
  `0 ≤ col < line.length`; if the line is empty, `col === 0`. A cursor at
  `line.length` is invalid in M1 because all templates start in normal mode.
- `edge: last` on a zero-length span is invalid. An empty line's only valid cursor is
  `{ line: n, col: 0 }`.
- The initial cursor MUST NOT be clamped by `initialState`. CI asserts
  `initialState({ buffer, cursor }).cursor` equals the declared cursor for every
  instance. If it would clamp, the template is wrong.
- Goal cursor semantics are **exact equality**: same line, same code-point column.
  There is no tolerance, range, or "near enough".
- Goal buffer semantics are **exact array equality**: same number of lines, same
  strings, including empty lines and trailing spaces. There is no newline at EOF
  concept in content; the engine buffer is an array.
- `edit-to-match` ignores the final cursor. `move-to-target` ignores the final buffer
  for judging, but the reference solution must not change it (§4.5).
- Content does not require the final mode. `move-to-target` is protected by
  motion-only allowed keys; `edit-to-match` is judged on text only. This matches
  `app/ARCHITECTURE.md`'s final-state challenge types. See C15; O3 is resolved.

### 4.8 Allowed keys

```yaml
allowed:
  preset: motion.word
  extra: ["3"]
```

or

```yaml
allowed: ["w", "b", "e", "Escape"]
```

| Form | Rules |
|---|---|
| `preset` | named preset in `content/presets/allowed-keys.yaml`; optional `extra` array |
| array | 1–64 valid tokens; unique after normalization |

The compiler expands presets, deduplicates, sorts by code point, and freezes the
result. The public instance's `allowedKeys` is that array. There is no runtime preset
lookup.

Tokens MUST be valid engine tokens, restricted by content's ASCII policy to:

- one printable ASCII code point (`0x20–0x7E`),
- one of `Escape`, `Enter`, `Backspace`, `Delete`, `Tab`,
- or `Control-<printable ASCII>`.

The engine does not export its token validator (Appendix G1), so content maintains the
grammar and a test that pins the documented vocabulary. This is a known duplication;
see the gap recommendation.

**Allowed keys are a safety boundary, not a straitjacket.** They prevent buffer edits
in movement lessons and unsupported commands in general; they do not force the
reference path. A learner may use any allowed motion/operator to reach the goal, and
may beat par. This is intentional: the app judges final state only, and failing a
correct solution because it used a different motion is worse than allowing an
alternative path. The lesson prose and `keyLegend` teach the intended path; par
benchmarks it.

Presets:

| Preset | Intended use | Contains |
|---|---|---|
| `motion.char` | h/j/k/l, 0/^/$, gg/G | `h j k l 0 ^ $ g G` + digits + `Escape` |
| `motion.word` | w/b/e/W/B/E | `w b e W B E` + digits + `Escape` |
| `motion.line` | line edges and vertical movement | `0 ^ $ j k g G` + digits + `Escape` |
| `motion.find` | f/t/F/T and repeats | `f t F T ; ,` + digits + `Escape`; add the fixed target char via `extra` |
| `edit.basic` | insert/operator correction | `i a I A o O Escape Backspace Enter` + `u Control-r`; add lesson-specific tokens via `extra` |
| `edit.word` | word operators/text objects | `d c y x r s S C D` + `w b e i a` + `Escape Backspace u Control-r`; add typed literals via `extra` |

Presets are authoring sugar. A template may list explicit tokens instead. A template's
solution tokens MUST be a subset of the resolved allowed set. `extra` is deduplicated
with the preset before sorting.

**Movement safety check.** For `move-to-target`, every resolved allowed token MUST be
in content's `MOTION_TOKENS` classification: the M1 motions, digits, `Escape`, and
safe `f`/`t` target characters that are not editing commands. The compiler rejects
`x`, `d`, `c`, `i`, `v`, `u`, `.`, `~`, `>`, `<`, `p`, `y`, `r`, etc. in a movement
template. `f`/`t` target characters SHOULD be punctuation from the safe set
(`- ( ) [ ] { } " ' , ;`) rather than letters that double as editing commands.

For `edit-to-match`, no such classification applies. Allowing a no-op key is harmless
(the engine treats it as an unrecognized no-op, but the app's policy check still lets
it through); allowing a key that edits is the point. Authors SHOULD keep edit sets
relevant and include `Escape`/`Backspace` for correction.

### 4.9 Reference solution and par

```yaml
solution:
  keys: ["c", "i", "w", "d", "o", "n", "e", "Escape"]
par: 8
```

- `solution.keys` is a literal token sequence, fixed for every instance of the
  template. There is no per-instance solution derivation in M1 (§5.9).
- Every token MUST be a valid engine token, in the allowed set, and recognized at its
  step by every supported engine version.
- `par` MUST equal `solution.keys.length`. This is checked at compile time and again
  per generated instance (it is constant for literal solutions).
- Par is the reference path length. It is **not** a proven minimum. A shorter path
  may exist within the allowed set; the app passes it, and M3 mastery must handle
  `keystrokes < par` (an app/M3 concern; see C14 and O4).
- The published runtime contains `par` and `allowedKeys` but **not** `solution`.
  CI uses the validation artifact.

### 4.10 Complete `move-to-target` example

This template is active for the engine range in `compatibility.yaml` and is part of
the first release.

```yaml
id: template.word-forward.basic
lesson: lesson.word-forward
order: 10
status: active
type: move-to-target
engine: ">=0.4.0 <0.5.0"
title: Third word start
description: Move from the first word to the start of the third word.
notes: |
  Every generated line is exactly three single-word items separated by one
  space. The cursor starts at the first span and the goal is the third span
  start. w w is invariant under word substitution.
generate:
  - op: pick
    name: words
    pool: words.common
    count: 3
    unique: true
    constraints:
      length: { min: 3, max: 7 }
      charset: ascii-lower
  - op: line
    name: line
    parts:
      - ref: words.0
        as: first
      - text: " "
      - ref: words.1
        as: second
      - text: " "
      - ref: words.2
        as: third
  - op: buffer
    name: buffer
    lines:
      - ref: line
initial:
  buffer: { ref: buffer }
  cursor: { line: 0, at: line.first, edge: start }
goal:
  kind: cursor
  cursor: { line: 0, at: line.third, edge: start }
allowed:
  preset: motion.word
solution:
  keys: ["w", "w"]
par: 2
```

### 4.11 Complete `edit-to-match` example

This template is a draft until the operator/text-object engine slice lands. The
engine range is illustrative; the real range must name a tested engine version.

```yaml
id: template.textobject-word.change
lesson: lesson.textobject-word
order: 10
status: draft
type: edit-to-match
engine: ">=0.4.0 <0.5.0"
title: Change the middle word
description: Replace the second word with done using a text object.
notes: |
  The line is three words separated by single spaces. Cursor is inside the
  second word. ciw replaces the inner word and leaves the surrounding spaces.
generate:
  - op: pick
    name: words
    pool: words.common
    count: 3
    unique: true
    constraints:
      charset: ascii-lower
      length: { min: 3, max: 7 }
  - op: line
    name: before
    parts:
      - ref: words.0
        as: first
      - text: " "
      - ref: words.1
        as: second
      - text: " "
      - ref: words.2
        as: third
  - op: line
    name: after
    parts:
      - ref: words.0
        as: first
      - text: " done "
      - ref: words.2
        as: third
  - op: buffer
    name: initial
    lines:
      - ref: before
  - op: buffer
    name: target
    lines:
      - ref: after
initial:
  buffer: { ref: initial }
  cursor: { line: 0, at: before.second, edge: start }
goal:
  kind: buffer
  buffer: { ref: target }
allowed:
  preset: edit.word
  extra: ["d", "o", "n", "e"]
solution:
  keys: ["c", "i", "w", "d", "o", "n", "e", "Escape"]
par: 8
```

### 4.12 Schema rules summary

The compiler MUST reject:

- unknown fields (strict objects), duplicate YAML keys, anchors/aliases, custom tags;
- IDs that do not match their path, duplicate IDs, active IDs missing from the
  registry, retired IDs reused, or active objects with a retired/absent file;
- duplicate slugs globally, including retired lesson slugs;
- missing group/skill/lesson/template references, prerequisite cycles, duplicate
  order values, or a primary skill whose group differs from the lesson's group;
- active lessons with no active template, active skills with no active lesson, active
  lessons referencing draft skills, or draft lessons with active templates;
- an active template whose engine range is not satisfied by every tested engine
  version (drafts may declare any syntactically valid range);
- pool references that do not exist, filtered pools too small for the pick, or
  duplicate pool items;
- any buffer/prose/token string that violates the ASCII, length, tab, newline, or
  control-character rules;
- a solution token missing from the allowed set, a solution token invalid for the
  engine vocabulary, par ≠ solution length, or a `move-to-target` allowed token
  outside `MOTION_TOKENS`;
- an initial state that already satisfies the goal, or a goal/initial cursor that can
  be out of bounds for some generated instance.

---

## 5. Deterministic generation

### 5.1 Model

A template is a small dataflow graph:

1. `pick` ops select strings from static pools, consuming the PRNG.
2. `line` ops compose strings and record named spans.
3. `buffer` ops compose lines into arrays.
4. `initial` and `goal` reference facts/spans and are resolved per instance.

There are no expressions, no conditionals, no loops beyond static op/part arrays, and
no user-controlled iteration. Generation is a straight-line interpreter over at most
32 ops. The same compiled template and seed always produce the same fact table, the
same buffer, the same spans, and therefore the same instance.

The public instance is the projection:

```
{ templateId, lessonId, lessonSlug, challengeType, buffer, cursor, goal,
  allowedKeys, par, contentVersion, schemaVersion }
```

The fact table, pool contents, and solution are discarded/private.

### 5.2 Seed derivation and PRNG

Content uses a pinned 32-bit string hash (xmur3 finalization) and **mulberry32**, as
required by `app/ARCHITECTURE.md` D9. The following is the normative algorithm; the
implementation MUST match it byte-for-byte and tests MUST pin known vectors.

```ts
/** Pinned 32-bit string hash. Input is ASCII/UTF-8; charCodeAt is sufficient. */
function hash32(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Pinned mulberry32 returning a uint32. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}
```

Streams are domain-separated. `\0` means the single byte `0x00`.

| Purpose | Hash input |
|---|---|
| Template selection | `"select\0" + lessonId + "\0" + seed` |
| Instance generation | `"generate\0" + templateId + "\0" + seed` |
| Build/test enumeration | `"enumerate\0" + templateId + "\0" + seed` |

The content version is **not** part of the hash input. The tuple
`(template_id, seed, content_version)` identifies the generation function; the
function may be insensitive to the version. This has two desirable consequences:

- The same template and seed produce the same instance across content releases if the
  template and interpreter are unchanged.
- A content version bump does not reshuffle every template; only changed templates
  change.

The version still provides affinity: an attempt records the version, and the app
expires open attempts when it changes (`app/ARCHITECTURE.md` D14). If a change to the
template or interpreter alters output, that is a versioned content change.

Pick algorithm:

- `unique: true`: partial Fisher–Yates. For `i` from `0` to `count-1`, choose
  `j = i + (nextUint32() % (n - i))`, swap `items[i]`/`items[j]`, take `items[i]`.
  Consumes exactly `count` draws.
- `unique: false`: for each item, `j = nextUint32() % n`, take `items[j]`.
  Consumes exactly `count` draws.

Modulo bias is irrelevant here: content needs variety and determinism, not uniform
cryptographic selection. The seed is server-chosen and not a security boundary;
attempts are still validated by replay.

The interpreter MUST use integer arithmetic and code-point string operations only. It
MUST NOT use `Math.random`, floats for indexing, locale-aware comparison, `Intl`,
`Date`, `crypto`, or environment-dependent behavior.

### 5.3 Constraints and resolved pools

Constraints filter static pools at build time, preserving source order. The compiled
template contains the filtered item array inline; there is no runtime pool table and no
runtime filtering. This guarantees:

- a pick cannot fail at runtime due to a constraint;
- generation cost is independent of pool size;
- changing a pool changes only templates that reference it;
- the build ID and golden tests capture the change.

Pool items are unique (case-sensitive) and validated by pool kind. Reordering items
changes generation; it is a content change and requires a version bump. The compiler
does not sort items alphabetically, so authors can curate order.

### 5.4 Canonical serialization

Two canonical forms are defined. Both are ASCII/UTF-8, integer-only, and independent
of object construction order.

- **Canonical JSON (hash form):** object keys sorted by code unit, no whitespace,
  arrays in order, strings JSON-escaped by the standard algorithm, integers only.
  Used for the build ID and instance hashes.
- **Canonical generation subject:** the instance minus `contentVersion` and
  `schemaVersion`, with object keys sorted. Used to compare generated output across
  content versions and to keep golden fixtures stable across release bumps.
- **Pretty fixtures:** 2-space indented canonical JSON with a trailing newline, for
  human review. Fixtures use the generation subject, not the full instance, so a
  version bump does not churn every file.

`allowedKeys` is sorted by code point. `buffer`, `goal.buffer`, and all fact arrays
preserve authored/generated order. There are no floats; a float anywhere in content is
a schema error.

### 5.5 Determinism scope

The guarantee is:

> For a fixed installed `@vim-villain/content` version, a fixed `template_id`, and a
> fixed seed, generation returns a byte-identical instance on every supported runtime
> and OS.

The guarantee is **not** that every seed maps to a distinct instance. Small pools and
small pick counts produce collisions; that is acceptable. The guarantee is also not
that two different content versions produce the same instance for a seed. If a
template or the interpreter changes, output may change; the content version records
which function was used.

Cross-runtime checks: CI runs the built bundle under Bun and Node 22 and compares
golden hashes. The browser check is a bundling check (no Node built-ins), not a DOM
test. Integer-only PRNG operations make the result platform-independent.

### 5.6 Worked example: same seed, same instance

Template `template.word-forward.basic` from §4.10. Example pool, in source order:

```yaml
id: words.common
kind: word
items:
  - alpha
  - bravo
  - charlie
  - delta
  - echo
  - foxtrot
  - golf
  - hotel
  - india
  - juliet
  - kilo
  - lima
```

Two seeds:

```
seed A = "00000000000000000000000000000001"
seed B = "00000000000000000000000000000002"
```

Generation stream: `hash32("generate\0template.word-forward.basic\0" + seed)`.

| Seed | Hash | Draws (3 unique items) | Buffer | Goal column |
|---|---|---|---|---|
| A | `477361523` | `golf`, `echo`, `india` | `["golf echo india"]` | 10 |
| B | `2408582874` | `juliet`, `lima`, `alpha` | `["juliet lima alpha"]` | 12 |

Seed A produces:

```json
{
  "schemaVersion": 1,
  "contentVersion": "0.1.0",
  "lessonId": "lesson.word-forward",
  "lessonSlug": "word-forward",
  "templateId": "template.word-forward.basic",
  "challengeType": "move-to-target",
  "buffer": ["golf echo india"],
  "cursor": { "line": 0, "col": 0 },
  "goal": { "kind": "cursor", "cursor": { "line": 0, "col": 10 } },
  "allowedKeys": [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    "B", "E", "Escape", "W", "b", "e", "w"
  ],
  "par": 2
}
```

Calling `startLesson("word-forward", seedA)` again returns the same generation subject
and the same canonical hash. Calling it with seed B returns the seed B row. The hash
values above are pinned by a unit test; the picked words are pinned by the golden
fixture. The allowed-key array is sorted, which is why `B`, `E`, `Escape`, `W` precede
lowercase `b`, `e`, `w`.

The seed stream does not include `contentVersion`, so this example remains valid for
the same template in later content releases. The full instance's `contentVersion`
field changes, which is why golden fixtures use the generation subject.

### 5.7 Generation cost bounds

Generation is O(number of ops + output size) with small constants:

- at most 32 ops, 32 total picked items, 8 items per pick;
- at most 12 buffer lines, 100 code points per line, 600 total;
- at most 64 facts and 64 allowed keys;
- no runtime filtering, no retries, no recursion, no unbounded loops;
- no allocation proportional to seed space or pool space beyond the resolved inline
  arrays.

CI runs a 10,000-instance generation loop under a generous wall-clock cap (5 seconds
on the CI runner) as a regression signal, not as a per-request SLA. The structural
bounds are the real guarantee. The app's rate limits bound request volume.

### 5.8 What is not expressible

- Arbitrary code, `eval`, `new Function`, dynamic import, plugins, or scripts.
- Network, filesystem, environment variables, clock, locale, `Intl`, `Math.random`, or
  cryptographic randomness.
- Conditionals, loops, recursion, variable line counts, or variable structure.
- String interpolation, slicing, arithmetic, case conversion, or regex.
- Nested templates, template imports, or content composition.
- Generated reference solutions or per-instance solution derivation (M1; see §5.9).
- Per-instance allowed-key sets. The allowed set is fixed per template.
- Non-ASCII buffer text, tabs, images, audio, or Markdown/HTML prose.
- Adaptive difficulty, player-state-dependent generation, or personalized content.

A lesson that needs any of these is out of scope for M1. Adding a capability is a
generator version/schema change with a content version bump, not a YAML trick.

### 5.9 Reference-solution invariance

M1 uses **fixed literal solutions with generated text**. The template author must
prove that the fixed key sequence reaches the goal for *every* instance the generator
can produce. This is a proof obligation, supported by CI enumeration/sampling.

Invariance rules:

1. **Structural facts are static.** The number of words, separators, lines, and cursor
   anchors do not vary with the seed. Only the selected strings vary.
2. **Word-motion homogeneity.** For `w b e`, every picked item is a single `word` pool
   item (letters only), so word boundaries are exactly the spaces the template
   inserted. For `W B E`, items may contain punctuation but never spaces, so WORD
   boundaries are the spaces.
3. **Unique anchors.** An `f`/`t` target character MUST appear exactly once on the
   line, or the template MUST account for occurrences. Pools used with a find target
   SHOULD forbid that character.
4. **Operator homogeneity.** For `iw`/`aw`/`dw`/`ciw`, picked items are single words
   and the cursor anchor is at the word start or inside it, so the text object's
   extent is the word and not a neighboring punctuation run. For `cw`/`caw`, anchor at
   the word start when the target is the whole word: `cw` from inside a word changes
   only the remainder, so an inside anchor would not produce a whole-word target.
5. **Fixed typed text.** Insert/change templates type a literal string (e.g. `done`,
   `!`). The target buffer is built from the same facts with the literal substituted,
   so the target matches regardless of surrounding words.
6. **No transformations.** Case operators, character replacement inside a generated
   word, and substring edits are not used in M1 templates unless the buffer text is
   fixed literal. They would require a transform/slice op or a derived solution.
7. **Initial ≠ goal.** For every instance, the initial state must not already satisfy
   the goal.

CI validates invariance by:

- **Enumeration** when the number of distinct pick outcomes is ≤ 10,000 (Cartesian
  product of pick choices, respecting uniqueness). This checks every possible
  instance, not a sample.
- **Sampling** otherwise: 256 deterministic seeds from the seed corpus plus named
  regression seeds. Because the structural invariants are static, sampling catches
  implementation mistakes rather than untested structure.
- Replaying the fixed solution against every enumerated/sampled instance and every
  engine version in the template's range;
- asserting goal satisfaction, every step recognized, final mode normal, initial ≠
  goal, and (for `move-to-target`) final buffer unchanged.

Per-instance derived solutions are deliberately **not** supported in M1. They would
make par variable, require a second derivation language, complicate allowed-key
generation, and weaken the app's "every template has a reference solution" contract.
If a future lesson needs them, add a new template form and a content major/minor
decision; do not smuggle them into `solution.keys`.

**Final-state judging cannot force a path.** A learner can solve an operator, visual,
or history lesson with a different allowed sequence. This is inherent in D13 and is
acceptable: lessons teach a path, par benchmarks it, and the goal judges the result.
History lessons are therefore instructional, not path-enforced; see O4.

### 5.10 Par

- Par is `solution.keys.length`, the reference path's keystroke count.
- Par is a benchmark and display value, not a maximum, minimum, or proof of optimality.
- A learner may submit more keys (if the goal is reached) or fewer (a shorter path).
- CI checks par equality and goal satisfaction. It does not prove optimality.
- Reviewers SHOULD look for an obviously shorter path within the allowed set. If one
  exists, either accept it (and note it) or adjust the goal/toolset. M3 mastery must
  handle efficiency > 100%; this is an app formula concern (see C14 and O4).

### 5.11 CI strategy for generation

| Check | Scope |
|---|---|
| Determinism | Generate each template/seed twice; canonical JSON equal |
| Golden hashes | Generation subject hash per template/seed matches committed goldens |
| Cross-runtime | Built bundle under Bun and Node 22 produces identical hashes |
| Enumeration | All instances for small outcome spaces; fixed solution passes each |
| Sampling | 256 seeds + regressions for larger spaces |
| Engine matrix | Replay against every tested engine version satisfying the template's range |
| Bounds | Max possible line/buffer/solution sizes within limits |
| No leakage | Recursively assert no `solution`, pool, or validation keys in public outputs |
| No initial pass | Initial state never satisfies the goal |

---

## 6. Curriculum and progression

### 6.1 Model

```
Group (presentation)
  └── Lesson (slug, prose, difficulty, 1..n skills)
        └── Template (challenge family, generator, goal, allowed, solution/par)
Skill (capability, group, order, prerequisites)
  └── referenced by lessons; progress is keyed by skill ID
```

Groups are curriculum buckets. Skills are capabilities. Lessons are teachable units.
Templates are challenge families. A lesson can teach multiple skills; a skill can be
taught by multiple lessons. Progress is per skill, never per lesson or template.

### 6.2 Ordering and prerequisites

- Groups: sorted by `order`, then ID.
- Skills: sorted by group order, then skill `order`, then ID.
- Lessons: sorted by group order, then lesson `order`, then ID.
- `order` values are unique within their scope (group for skills/lessons, lesson for
  templates). Duplicates are a CI error, not resolved by ID tie-breaking.
- Skill `prerequisites` form a DAG. CI rejects self-references and cycles. An active
  skill's prerequisites must be active.
- Lesson effective prerequisites are derived from its skills:
  `union(skill.prerequisites for skill in lesson.skills) - lesson.skills`, ordered by
  curriculum order.
- M1 does **not** gate lessons behind prerequisites. The app may use the metadata to
  recommend a next lesson or to order the list. There is no lock/unlock state in the
  API or database.
- Retiring a skill is out of scope for M1. Retire lessons/templates and keep the
  skill resolvable so `skill_progress` can still render a title.

### 6.3 API exposure without leaking solutions

`getCurriculum()` returns groups, lesson summaries, and skill summaries. It does not
return templates, allowed sets, solutions, or pars.

`getLesson(slug)` returns the lesson's prose, metadata, effective prerequisites,
challenge types, and key legend. It does not return template IDs, template counts,
allowed sets, or pars. The concrete allowed set and par arrive in the start response,
where they are tied to the selected template and seed.

`GeneratedInstance` includes `lessonId`, `lessonSlug`, `templateId`, `challengeType`,
`allowedKeys`, and `par`. It never includes `solution`.

Template IDs are exposed only because the app must store them for replay. Template
lookup is not exposed.

### 6.4 Status: active, draft, retired

| Status | In runtime? | In curriculum? | In registry? | File? |
|---|---|---|---|---|
| `active` | yes | yes | yes | yes |
| `draft` | no | no | yes | yes |
| `retired` | no | no | yes | no |

Rules:

- A new object starts as `draft` until its engine slice is published and tested. This
  lets contributors land content ahead of the engine without publishing unplayable
  lessons.
- Draft-only changes do not alter the runtime artifact or build ID, so they do not
  require a content version bump. They are excluded from the npm tarball.
- Activating a draft requires the engine version to be in the tested matrix and a
  content release. The release flips statuses and bumps the version.
- Retiring an active object removes its file, keeps its ID in the registry, and is a
  content minor (the curriculum changes). Retired IDs are never reactivated and never
  reused; a fixed replacement gets a new variant ID.
- A draft ID that was never active MAY be renamed or removed. Once active, it is
  permanent.
- An active lesson MUST have at least one active template. An active skill MUST have
  at least one active lesson. Retiring the last lesson of a skill requires a product
  decision; do not do it silently.

### 6.5 M1 content plan

The M1 target is **20 lessons, 28 templates, 18 skills**. The first publish is
**14 lessons, 21 templates, 12 skills**: all movement lessons plus insert and the
released operators. It targets the engine version in `compatibility.yaml` at release
time. Later slices add content as the engine lands. Counts are editorial scope, not
invariants; see O1.

Skills:

| # | Skill ID | Group | Teaches | Prerequisites |
|---|---|---|---|---|
| 1 | `skill.motion.char` | movement | `h j k l` | — |
| 2 | `skill.motion.word` | movement | `w b e` | 1 |
| 3 | `skill.motion.big-word` | movement | `W B E` | 2 |
| 4 | `skill.motion.line` | movement | `0 ^ $` | 1 |
| 5 | `skill.motion.file` | movement | `gg G` | 4 |
| 6 | `skill.motion.find` | movement | `f t F T ; ,` | 1 |
| 7 | `skill.motion.count` | movement | counts | 1, 2 |
| 8 | `skill.insert.basic` | insert | `i a I A`, typing, `Esc`, `Backspace` | 1 |
| 9 | `skill.insert.lines` | insert | `o O` | 8 |
| 10 | `skill.operator.delete` | operators | `d`, `dd`, `dw` (later: `x X D`) | 2 |
| 11 | `skill.operator.change` | operators | `c`, `cw`, `cc` (later: `C s S`) | 10 |
| 12 | `skill.operator.indent` | operators | `> <` | 4 |
| 13 | `skill.textobject.word` | text-objects | `iw aw` | 10 |
| 14 | `skill.textobject.quote` | text-objects | `i" i'` | 13 |
| 15 | `skill.visual.char` | visual | `v` + operator | 10 |
| 16 | `skill.register.unnamed` | registers | `y p P` | 10 |
| 17 | `skill.history.undo` | history | `u Control-r` | 10 |
| 18 | `skill.history.dot` | history | `.` | 11 |

Lessons and templates:

| # | Lesson ID | Group | Templates | Engine slice | First publish |
|---|---|---|---|---|---|
| 1 | `lesson.char-moves` | movement | `horizontal`, `vertical` | motions | active |
| 2 | `lesson.word-forward` | movement | `basic` | motions | active |
| 3 | `lesson.word-back` | movement | `basic` | motions | active |
| 4 | `lesson.word-end` | movement | `basic` | motions | active |
| 5 | `lesson.big-word` | movement | `basic` | motions | active |
| 6 | `lesson.line-edges` | movement | `start`, `end` | motions | active |
| 7 | `lesson.file-edges` | movement | `top`, `bottom` | motions | active |
| 8 | `lesson.find-char` | movement | `forward`, `backward` | motions | active |
| 9 | `lesson.counts` | movement | `word` | motions | active |
| 10 | `lesson.insert-basic` | insert | `insert`, `append` | insert | active |
| 11 | `lesson.insert-lines` | insert | `open-below`, `open-above` | insert | active |
| 12 | `lesson.delete-word` | operators | `dw`, `dd` | operators | active |
| 13 | `lesson.change-word` | operators | `cw` | operators | active |
| 14 | `lesson.indent-line` | operators | `shift` | operators | active |
| 15 | `lesson.textobject-word` | text-objects | `change` | text objects | draft |
| 16 | `lesson.textobject-quote` | text-objects | `change` | text objects | draft |
| 17 | `lesson.visual-char` | visual | `delete`, `change` | visual | draft |
| 18 | `lesson.yank-paste` | registers | `line` | registers | draft |
| 19 | `lesson.undo-redo` | history | `basic` | history | draft |
| 20 | `lesson.dot-repeat` | history | `word` | history | draft |

Template IDs follow `template.<lesson-slug>.<variant>`, e.g.
`template.char-moves.horizontal`, `template.delete-word.dw`,
`template.textobject-quote.change`.

Representative exercises:

- `template.char-moves.horizontal`: cursor col 0, safe marker at col 5, `5l` or
  `l l l l l`; varies the suffix text.
- `template.char-moves.vertical`: cursor col 0 on line 0, goal col 0 on line 2;
  `2j`; varies line text.
- `template.word-forward.basic`: three words, cursor at first, goal third start;
  `w w`.
- `template.word-back.basic`: cursor third start, goal first start; `b b`.
- `template.word-end.basic`: cursor first start, goal third end; `e e e`.
- `template.big-word.basic`: punctuation-joined WORDS, goal next WORD start; `W`.
- `template.line-edges.start`: indented line, cursor at end, goal first non-blank;
  `^` (or `0` + `w`).
- `template.line-edges.end`: cursor col 0, goal last char; `$`.
- `template.file-edges.top`: cursor col 0 on a middle line, goal first line col 0;
  `gg`.
- `template.file-edges.bottom`: cursor col 0 on the first line, goal last line col 0;
  `G`.
- `template.find-char.forward`: one `-` marker, cursor col 0, goal marker; `f-`.
- `template.find-char.backward`: cursor at line end, marker to the left; `F-`.
- `template.counts.word`: four words, cursor first, goal fourth start; `3w`.
- `template.delete-word.dw`: three words, cursor second start, goal word1 + word3;
  `dw`.
- `template.delete-word.dd`: three lines, cursor middle, goal line1 + line3; `dd`.
- `template.change-word.cw`: three words, cursor second start, replace with `done`;
  `cw` + `done` + `Esc`.
- `template.indent-line.shift`: line at col 0, goal two leading spaces; `>>`.
- `template.textobject-word.change`: three words, cursor inside second, replace with
  `done`; `ciw` + `done` + `Esc`.
- `template.textobject-quote.change`: `say "word" now`, cursor inside quotes, replace
  with `done`; `ci"` + `done` + `Esc`. The template's allowed set must include `"`
  explicitly; allowed-key safety is independent of the reference solution.
- `template.visual-char.delete`: one word, goal empty line; `v i w d`.
- `template.visual-char.change`: one word, goal `done`; `v i w c` + `done` + `Esc`.
- `template.yank-paste.line`: one line, goal duplicated line; `yy p`.
- `template.undo-redo.basic`: three words, delete the middle with `dw`, undo, redo;
  `dw u Control-r`; goal is the deleted state. Path not enforced.
- `template.dot-repeat.word`: three words, replace words 2 and 3 with `done`;
  `cw done Esc w .`; path not enforced.

### 6.6 First publish

The first publish covers motion, insert, and the released operators: 14 lessons, 21
templates, and 12 skills. It uses only engine behavior present in the tested version.
The remaining M1 content (text objects, visual mode, registers, history) is drafted in
the repo (`status: draft`) but excluded from the npm artifact and curriculum until its
engine slice is tested.

### 6.7 Incremental shipping

| Content release | Newest engine slice | Active lessons/templates | Skills |
|---|---|---|---|
| `0.1.0` | motions + insert + operators | 14 / 21 | 12 |
| `0.2.0` | text objects + visual | 17 / 25 | 15 |
| `0.3.0` | registers + history | 20 / 28 | 18 |

Release numbers are illustrative; the slice order is the commitment. A content release
MUST satisfy the invariant in §7.6: every active template works on every tested engine
version. When a new slice requires newer commands, the tested set/floor moves up and
the app upgrades the engine first.

---

## 7. Identity and versioning

### 7.1 IDs

| Object | Format | Example | Allocation |
|---|---|---|---|
| Skill | `skill.<namespace>.<name>` | `skill.motion.word` | path `skills/<namespace>/<name>.yaml` |
| Lesson | `lesson.<slug>` | `lesson.word-forward` | path `lessons/<group>/<slug>/lesson.yaml` |
| Template | `template.<slug>.<variant>` | `template.word-forward.basic` | path `.../templates/<variant>.yaml` |

Rules:

- Lowercase ASCII, dot-separated; each segment matches
  `[a-z0-9](?:[a-z0-9-]*[a-z0-9])?`, 1–40 chars; total ≤ 120 chars.
- The authored `id` MUST equal the path-derived ID. This prevents silent identity
  drift when files move.
- IDs are globally unique. Skill names are unique within a namespace; lesson slugs are
  globally unique; template variants are unique within a lesson.
- IDs are permanent once **active**. A retired ID remains in the registry forever and
  MUST NOT be reused. A draft ID that was never active MAY be renamed or removed.
- The database references IDs, never slugs (`app/ARCHITECTURE.md` D10). Attempts and
  progress never dangle when titles, groups, or prose change.

### 7.2 Slugs

- A lesson slug is the final segment of its ID: `lesson.word-forward` → `word-forward`.
  There is no separate slug registry; the ID registry preserves it.
- Slugs are globally unique, including against retired lesson slugs. A new lesson
  cannot reuse a retired slug.
- Slugs are permanent once active. A title (presentation) can change freely; a slug
  change would break URLs and IDs. If a lesson needs a new slug, create a new lesson
  ID and retire the old one; progress is per skill, so no migration is needed.
- A lesson's `group` is metadata and MAY change without changing its ID/slug. The
  directory and `group` field move together; CI checks they agree.
- Template variants follow the same rule: active variant IDs are permanent; add a new
  variant rather than renaming.

### 7.3 Registry

`registry/ids.yaml` is the immutable allocation record.

```yaml
schema: 1
ids:
  - id: skill.motion.char
    kind: skill
    status: active
  - id: lesson.word-forward
    kind: lesson
    status: active
  - id: template.word-forward.basic
    kind: template
    status: active
  - id: lesson.old-exercise
    kind: lesson
    status: retired
    notes: Replaced by lesson.word-forward; retired in 0.4.0.
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `id` | string | yes | matches the ID format |
| `kind` | enum | yes | `skill`, `lesson`, `template`; must match the prefix |
| `status` | enum | yes | `active`, `draft`, `retired` |
| `notes` | string | no | 0–240 ASCII; retirement reason |

CI rules:

- IDs are unique and sorted; unknown fields are errors.
- Every current file's ID exists in the registry with matching kind and status.
- Every `active` registry ID has a current file; every `draft` ID has a current file;
  every `retired` ID has no current file.
- A `retired` ID cannot return to `active` or `draft`; IDs are never reused.
- Removing a `draft` entry is allowed (it was never public). Removing an `active` or
  `retired` entry is forbidden, forever, including in a major release.
- Changing an `active` or `retired` ID is forbidden. A draft ID may be replaced by a
  new draft ID.
- Slugs are derived from lesson IDs and checked for global uniqueness across active,
  draft, and retired lessons.

The registry is not published. Its value is the CI guarantee and the historical
record; the git history is the audit trail.

### 7.4 Content semver

Content versions are semantic versions. The package is `0.x` until its public API and
schema are declared stable.

| Bump | While `0.x` | After `1.0` |
|---|---|---|
| `PATCH` | No change to the compiled runtime payload/build ID (docs, tests, CI, byte-identical rebuild), **or** a compatibility-only change to the tested engine list/peer range that does not alter generated output. Compatibility-only changes still require an explicit version bump; CI enforces this even though the build ID is unchanged. | Same |
| `MINOR` | Any change to the compiled runtime payload/build ID: new content, prose, allowed sets, goals, pars, or fixes. May be breaking per semver `0.x`. | New content/lessons/templates, additive API fields, or any change to generated output/goals/par for an existing template |
| `MAJOR` | `1.0.0` when declaring API/schema stability; otherwise no `0.x` major | Public API/schema break, ID/slug policy change, or incompatible engine floor jump |

Additional rules:

- Any change that can alter a generated instance, goal, allowed set, or par MUST bump
  the content version (`app/ARCHITECTURE.md` Content model). This is enforced by the
  build-ID check: if the runtime payload changes and the version does not, CI fails.
- Compatibility-only changes (adding/removing a tested engine version or changing the
  derived peer range) do not change the build ID but MUST bump the patch version. CI
  compares `compatibility.yaml` against the base branch and enforces the bump
  separately from the build-ID check.
- A version bump expires open attempts on deploy (D14). Batch editorial/content
  changes; do not publish per typo. A docs-only publish is allowed but discouraged
  because it needlessly expires attempts.
- IDs are never removed, even in a major. Retirement is the removal mechanism; the ID
  remains in the registry.
- The package version, `package.json`, `CONTENT_VERSION`, and the git tag MUST agree at
  release time.

### 7.5 `contentVersion`, build ID, schema version

| Value | Meaning | Stored in attempts? | Used for |
|---|---|---|---|
| `CONTENT_VERSION` | Published package semver | Yes (`content_version`) | Version affinity, release identity |
| `CONTENT_BUILD_ID` | SHA-256 of compiled runtime payload + generator/schema versions | No | Release integrity, CI drift detection, logs |
| `CONTENT_SCHEMA_VERSION` | Integer shape version of the public instance/API, starts at 1 | Indirectly via content version | App boot check, forward compatibility |
| `GENERATOR_VERSION` | Integer interpreter behavior version, starts at 1 | No | Build ID, release notes |

`contentVersion` is the package semver, not a content hash. Reasons:

- It is human-readable and matches npm/tag/release notes.
- npm versions are immutable; a published version maps to one artifact.
- The app already records and compares a version string.
- The build ID provides the integrity check without complicating the attempt schema.

The build ID is computed from the **runtime payload plus the generator and schema
versions**. The runtime payload includes active groups, skills, lessons (including
titles, prose, and curriculum metadata), and templates (operations, resolved pools,
allowed sets, goals, and par). It excludes the reference solutions, the registry,
tests, docs, and the compatibility metadata (tested engine list and peer range). A
comment-only change does not change it; a lesson title change does.

Compatibility-only changes therefore leave the build ID unchanged but still require a
patch version bump, enforced separately in §7.4 and §8.5.

`CONTENT_SCHEMA_VERSION` bumps only for an incompatible public shape change. Additive
optional fields do not bump it. The app supports a specific schema version at boot; an
unknown version is a startup failure.

If presentation-only releases become a real operational cost (open attempts expiring
for a typo fix), the alternative is a generation hash as `content_version` plus a
separate package version. That requires an app schema/contract change and is recorded
as O7. M1 stays with semver.

### 7.6 Engine compatibility

The governing invariant:

> Every active template MUST work on every engine version in
> `TESTED_ENGINE_VERSIONS`.

This is what lets content be engine-version-agnostic at runtime. The app boots only
when its engine version is in the tested list; content never branches on engine
version.

- `content/compatibility.yaml` declares `engineRange` and the exact `tested` list:

```yaml
engineRange: ">=0.4.0 <0.5.0"
tested:
  - "0.4.0"
```

- The tested list is exact `x.y.z` versions, ascending, unique, and contiguous by
  minor (no gaps such as 0.2 and 0.4 without 0.3). A gap would make the derived peer
  range claim untested versions.
- `package.json`'s `peerDependencies["@vim-villain/engine"]` MUST equal `engineRange`.
  The range is derived from the tested list: floor = lowest tested, ceiling = one
  minor above the highest tested minor (e.g. `0.4.x` → `<0.5.0`; `0.4.x` + `0.5.x` →
  `<0.6.0`). Because engine minors are pre-1.0, content treats every tested minor as
  potentially behavior-changing and never uses an open-ended range.
- An **active** template's `engine` range MUST be satisfied by **every** tested
  version; otherwise it belongs in `draft` or the tested set must drop that version
  (which raises the floor and requires a content release).
- A **draft** template MAY declare any engine range, including versions not yet in the
  tested list. Drafts are excluded from the runtime payload and the compatibility
  matrix. Before a draft is activated, it must satisfy the active-template rule.
- CI replays every active template against every tested version. This is the matrix
  job, not the default unit job.
- Adding an engine version to the tested list requires a content release (patch if
  no runtime content changes; minor if the floor/ceiling changes in a way that
  affects consumers). The app cannot use an untested engine version by skipping this
  step.
- The peer range is for npm resolution, not the runtime gate. The app's boot check
  requires exact membership in `TESTED_ENGINE_VERSIONS`; a patch in the range but not
  in the list is not claimed.

Why so strict for `0.x`: the engine's versioning says a minor adds commands and a
major changes observable behavior, but pre-1.0 semver permits breaking minors, and
implementing a previously unrecognized key changes the outcome of sequences containing
it. Content does not assume minor-to-minor compatibility; it proves it per release.
See Appendix G2.

### 7.7 Boot check

The app MUST refuse to boot unless all of the following hold:

```ts
import { CONTENT_INFO, ENGINE_RANGE } from "@vim-villain/content";
import { ENGINE_VERSION } from "@vim-villain/engine";

// 1. npm-level range
semver.satisfies(ENGINE_VERSION, ENGINE_RANGE);

// 2. exact tested membership (the real gate)
CONTENT_INFO.testedEngineVersions.includes(ENGINE_VERSION);

// 3. schema forward compatibility
CONTENT_INFO.schemaVersion === APP_SUPPORTED_CONTENT_SCHEMA;

// 4. app pin / supported matrix
APP_SUPPORTED_MATRIX.some(
  (entry) => entry.content === CONTENT_INFO.contentVersion &&
             entry.engine === ENGINE_VERSION,
);
```

- On failure, log `CONTENT_INFO`, the installed engine version, and the app's matrix;
  exit non-zero. This is a startup failure, not a runtime surprise.
- The app SHOULD log `CONTENT_INFO.buildId` at boot and include it in internal error
  reports.
- The app MUST NOT catch a compatibility failure and serve anyway. A stale attempt can
  never be replayed across an incompatible pair.
- Content does not perform this check itself; it has no semver runtime dependency and
  no knowledge of the app's matrix. Content assumes it is called only after a
  successful boot check.

### 7.8 Open attempts when content changes

- An attempt is replayable only under the content version recorded at start. The app
  regenerates from the stored `template_id`, seed, and content version.
- Because the app installs one content version at a time, a content deploy that
  changes `CONTENT_VERSION` MUST expire open attempts and return a clear restart
  signal (D14). Content does not migrate attempts.
- A content release that only adds drafts does not change the runtime version and does
  not expire attempts.
- A content release that changes prose, allowed sets, goals, pars, or templates
  expires attempts. Batch such changes.
- Historical submitted/failed/expired attempts remain as data. They reference IDs that
  may be retired; the app should render the ID/slug or a generic label if the object is
  no longer resolvable. M1 does not guarantee historical lesson titles.
- If a rollback is needed, the app rolls back its image/pins to the previous content
  version; the previous npm version remains available. Content never unpublishes
  (npm immutability and downstream pins). A bad version is deprecated and followed by
  a fix.

---

## 8. Validation and CI

### 8.1 Pipeline

The pipeline is ordered and fail-fast. Each stage reports file, JSON Pointer, error
code, and a fix hint.

1. **Source hygiene.** YAML parses; one document per file; no anchors/aliases/custom
   tags; duplicate keys rejected; UTF-8/LF; no tabs; ASCII; file size ≤ 64 KiB;
   total content ≤ 2 MiB; no trailing whitespace; prose line length warning.
2. **Schema validation.** Strict Zod schemas for groups, skills, lessons, templates,
   pools, presets, compatibility, and registry. Unknown fields are errors. Required
   fields, types, ranges, lengths, token grammar, slug/ID grammar.
3. **Registry and identity.** ID uniqueness, path-derived equality, status/file
   consistency, no active/retired removal or reuse, draft-only removal allowed, slug
   global uniqueness including retired lessons, `kind` prefix match, sorted registry.
4. **Graph validation.** Group/skill/lesson/template references exist; primary skill
   group matches lesson group; prerequisites acyclic; active/draft status rules;
   active skills have active lessons; active lessons have active templates; order
   uniqueness; template `lesson` matches parent.
5. **Compile.** Resolve pools/presets/constraints; check filtered pool sizes; compute
   max line/buffer/solution sizes; resolve allowed sets; validate solution subset;
   validate motion-only allowed sets for `move-to-target`; validate par; emit runtime
   and validation artifacts; compute build ID.
6. **Generation and replay.** For every active template, enumerate (≤ 10,000
   outcomes) or sample (256 seeds + regressions); for every tested engine version
   satisfying the template's `engine` range:
   - build the initial state and assert no cursor clamping;
   - assert the initial state does not satisfy the goal;
   - replay `solution.keys` with `applyKeys`;
   - assert every step `recognized === true`;
   - assert final mode is normal;
   - assert `isGoalSatisfied(goal, finalState)`;
   - assert final buffer equals initial buffer for `move-to-target`;
   - assert `par === solution.keys.length` and `par <= 64`;
   - assert every solution token is in `allowedKeys`.
7. **Determinism and goldens.** Generate twice; canonical JSON equal. Compare
   generation-subject hashes to `tests/golden/instance-hashes.json`. Compare
   curriculum/lesson fixtures. Cross-runtime Bun/Node hash comparison.
8. **Public API contract.** Import from `dist` (not `src`); call every public
   function; assert shapes, null/throw behavior, frozen results, sorted allowed keys,
   `contentVersion`/`schemaVersion` values, and no `solution`/pool/validation keys in
   any public output. Snapshot the public API shape without volatile version values.
9. **Browser/package checks.** Bundle `dist/index.js` for the browser and assert no
   Node built-ins and no `@vim-villain/engine` value import. `npm pack --dry-run`:
   assert file whitelist, no YAML/registry/tests/scripts/validation artifact, tarball
   size ≤ 1 MiB unpacked / 250 KiB gzipped, `exports` only `.`.
10. **Version discipline.** Compare build ID to the base branch/last release. If it
    changed and `package.json.version` did not, fail. If the version is not greater
    than the latest published, fail at release time.
11. **Links and prose.** Relative links in README/CONTRIBUTING resolve. External links
    are checked nightly (network flakiness must not block PRs). Lesson prose contains
    no URLs, HTML, or Markdown links.
12. **Compatibility matrix.** `compatibility.yml` installs each exact engine version
    in an isolated workspace, builds content, and runs the replay suite. This is the
    expensive gate; it is required before release, not on every docs-only PR.

Content does **not** run Neovim. The engine is the oracle; content replays against the
engine and trusts the engine's differential suite. If a template depends on an
engine/Neovim divergence, the divergence belongs in the engine's `DIVERGENCES.md`;
content follows the engine, not a remembered Vim behavior.

### 8.2 Failure messages

Every validation error is structured:

```ts
interface ValidationError {
  code:
    | "E_YAML" | "E_SCHEMA" | "E_ID" | "E_REGISTRY" | "E_SLUG"
    | "E_REF" | "E_CYCLE" | "E_ORDER" | "E_STATUS" | "E_LIMIT"
    | "E_ALLOWED" | "E_SOLUTION" | "E_PAR" | "E_REPLAY" | "E_GOAL"
    | "E_DETERMINISM" | "E_VERSION" | "E_PACK";
  file: string;        // repo-relative
  pointer: string;     // JSON Pointer into the file
  message: string;     // what is wrong
  hint: string;        // what to do
}
```

CLI format:

```
E_SOLUTION content/lessons/motion/word-forward/templates/basic.yaml
  at /solution/keys/2
  key "x" is not in allowedKeys.
  hint: add "x" to allowed, or remove it from the solution.
```

Representative messages:

- `E_REGISTRY ... ID "lesson.word-forward" is active on disk but missing from registry/ids.yaml. Add it with status: active.`
- `E_REGISTRY ... ID "template.word-forward.basic" was retired and cannot be reused. Add a new variant ID.`
- `E_ID ... authored id "lesson.motion.word-forward" does not match path-derived "lesson.word-forward".`
- `E_SLUG ... slug "word-forward" is already used by retired lesson "lesson.word-forward". Slugs are never reused.`
- `E_REF ... template "..." goal cursor references span "line.third", but line fact "line" has no span "third".`
- `E_LIMIT ... pick "words" needs 3 unique items after constraints, but pool "words.common" has 2. Relax constraints or add words.`
- `E_ALLOWED ... move-to-target template allows "x", which is not a motion token and can change the buffer. Remove it or change the challenge type.`
- `E_REPLAY ... template "..." seed "..." on engine 0.2.0: expected cursor {line:0,col:8}, got {line:0,col:9} after ["w","w"].`
- `E_PAR ... par is 3 but solution.keys has 2 tokens.`
- `E_GOAL ... initial state already satisfies the goal for seed "..."; the challenge is trivial.`
- `E_VERSION ... runtime build ID changed but package.json version is still 0.1.0. Bump content (minor for runtime changes).`
- `E_PACK ... tarball contains content/lessons/.../templates/basic.yaml; only dist and docs may be published.`

Validation errors are for contributors and CI logs, not end users. They must be
specific enough to fix without reading the validator.

### 8.3 Fixtures and goldens

```
tests/fixtures/
  seeds.json                       # 256 corpus seeds + named regressions
  curriculum.json                  # normalized curriculum (no version fields)
  lessons/<slug>.json              # normalized lesson detail
  templates/<template-id>/<seed>.instance.json
  templates/<template-id>/<seed>.final-state.json
  invalid/                         # negative fixtures + expected error
    missing-allow-key.yaml
    duplicate-id.yaml
    cycle.yaml
    ...
tests/golden/
  instance-hashes.json             # per template/seed generation-subject hash
  public-api.json                  # stable shape snapshot
```

- Instance fixtures store the **generation subject** (no `contentVersion`/
  `schemaVersion`) so release bumps do not churn every file.
- `final-state.json` stores only the fields the test asserts: `buffer`, `cursor`,
  `mode` (and maybe `recognized` flags). It is not a full engine state dump.
- `seeds.json` has a deterministic corpus plus named regression seeds:
  `{ "regression": { "issue-123": "..." }, "corpus": ["..."] }`.
- Negative fixtures pair a YAML file with `expected.json` containing the expected
  `code`, `pointer`, and a message substring. This tests the validator and its
  messages.
- `bun run test:update` regenerates goldens. A golden diff is a review artifact; CI
  fails if goldens are stale. Regenerating without reviewing the diff is discouraged.

### 8.4 Test matrix

| Job | Engine versions | What it proves |
|---|---|---|
| `ci` (PR) | devDependency = lowest tested | Schema, compile, replay, determinism, API, browser, pack |
| `compatibility` (PR/release) | every exact `tested` version | Every active template on every supported engine |
| `release` | every exact `tested` version | Tag/version match, full suite, publish, post-publish smoke |
| `nightly` | lowest tested | Long enumeration, external links, dependency review |

The default `bun test` uses the lowest tested engine version. This catches floor
compatibility early; the matrix covers the rest. A developer may switch the dev
dependency locally, but committed manifests and CI use the floor.

### 8.5 Version discipline

- Any runtime payload change requires a version bump. CI compares the build ID
  against the base branch. Draft-only changes do not change the runtime payload and do
  not require a bump.
- A compatibility-only change (tested engine list or derived peer range) requires a
  patch bump even though the build ID is unchanged. CI compares
  `compatibility.yaml` to the base branch and enforces this separately.
- The release workflow verifies the git tag (`vX.Y.Z`) equals `package.json.version`
  and `CONTENT_VERSION`.
- The release version MUST be greater than the latest published version. No
  re-tagging, no republishing, no mutable tags.
- `CHANGELOG.md` has an entry per release with: content version, build ID, tested
  engine versions, active skill/lesson/template counts, added/changed/retired IDs, and
  a note that open attempts expire.

### 8.6 Package and browser checks

- `tsconfig.json` has `lib: ["ES2022"]` and `types: []`; runtime source cannot use
  Node/DOM types. Build/test scripts use `tsconfig.scripts.json`.
- The bundle check rejects `node:*`, `fs`, `path`, `crypto`, `process`, `Buffer`,
  `__dirname`, and dynamic `import()`.
- `npm pack --dry-run` asserts the file whitelist and size. The post-publish smoke
  installs the tarball in a clean temp project with each tested engine and compares
  generated instances to the repo's fixtures.
- A Node 22 smoke run compares hashes to Bun; this is the universal-runtime check.

---

## 9. Authoring and contribution

### 9.1 Layout and naming

```
content/
  groups.yaml
  compatibility.yaml
  skills/<group>/<name>.yaml
  lessons/<group>/<slug>/lesson.yaml
  lessons/<group>/<slug>/templates/<variant>.yaml
  pools/<kind>/<name>.yaml
  presets/allowed-keys.yaml
registry/ids.yaml
```

- Files and directories are lowercase kebab-case. Lesson directories equal slugs.
  Template files equal variants. Skill files equal names.
- IDs are authored and checked against the path; do not rely on the path alone.
- One object per file. No multi-document YAML.
- Comments are welcome for author notes; they are discarded at compile time.
- YAML strings that could be misread (`0`, `on`, `off`, `yes`, `no`, `null`, `~`,
  `#`, `:`) MUST be quoted. All key tokens MUST be quoted. All buffer text SHOULD be
  quoted.
- Use block scalars (`|`) for prose. The compiler trims leading/trailing blank lines
  and normalizes line endings.

### 9.2 Adding a lesson

1. **Pick or add a skill.** If new, add `content/skills/<group>/<name>.yaml` and a
   registry entry with `status: draft` (or `active` if it ships now). Check
   prerequisites are acyclic.
2. **Create the lesson directory** under `content/lessons/<group>/<slug>/`. Add
   `lesson.yaml` with ID, slug, title, summary, instructions, hints, difficulty, and
   skills. Keep prose ASCII and plain text.
3. **Add templates** under `templates/`. Start with one variant. Use a pool and a
   line/buffer program; keep the buffer small. Write a literal solution and set par.
   Add `notes` explaining why the solution is invariant for every seed.
4. **Allocate IDs** in `registry/ids.yaml` with matching kind/status. New content
   starts `draft` until its engine slice is tested. Add all three IDs (skill if new,
   lesson, template).
5. **Run** `bun run validate` (schema/registry/graph), `bun run test` (replay,
   determinism, API), and `bun run build`. Fix errors; do not suppress them.
6. **Add a golden** with `bun run test:update`, then review the generated instance and
   final state. Confirm the challenge is not trivially satisfied at start.
7. **Write the PR** with a short rationale, the skill/lesson/template IDs, the engine
   slice, and any seed(s) that demonstrate the instance. Update `CHANGELOG.md` if the
   release will include it.
8. **Review** against §9.3. A maintainer activates drafts only in a release PR.

### 9.3 Review checklist

- **One teachable idea.** The lesson has a clear goal and a short instruction. The
  title/summary match the actual exercise.
- **Goal correctness.** The goal is exact, in code points, reachable with the allowed
  set, and not already satisfied at start.
- **Solution invariance.** The fixed solution works for every generated instance. The
  author's `notes` explain why; structural facts are static.
- **No accidental shorter path.** Reviewers check the allowed set for an obviously
  shorter alternative. If one exists, either accept it and note it, or adjust the goal
  or toolset.
- **Allowed keys.** Movement templates allow only motion/correction tokens. Edit
  templates include `Escape`/`Backspace` for correction and the commands the lesson
  teaches. The solution is a subset.
- **ASCII and size.** No non-ASCII, tabs, control characters, or overlong lines.
  Buffers are small (prefer 1–4 lines, ≤ 60 chars).
- **Prose quality.** Second person, imperative, present tense. Explain the motion, not
  the UI. No URLs, HTML, Markdown, or exact key-sequence giveaways in hints.
- **Engine slice.** `engine` names a tested version/range; the command set exists in
  that slice. Drafts may target an unreleased slice but cannot activate until tested.
- **Identity.** IDs/slugs follow the path, are unique, and are registered. No active
  ID is removed or reused.
- **No offensive/ambiguous content.** Pools and prose are neutral. Avoid `l`/`1`,
  `I`/`O`/`0` confusion in beginner buffers and find targets.

### 9.4 Style guide

- **ASCII only.** Lowercase words in pools; punctuation only when the lesson needs it.
- **No tabs in buffers.** Use spaces. The engine's indent width is fixed at 2
  (`SHIFT_WIDTH`); indentation lessons use two spaces.
- **Small buffers.** 1–4 lines is ideal; 12/100 is the hard cap. A learner should see
  the target without scrolling.
- **Neutral text.** No personal data, brands, slurs, politics, or jokes that depend on
  culture/locale. Pools are curated and reviewed.
- **Plain prose.** Short paragraphs; no Markdown. Use `\n\n` between paragraphs. Hints
  are progressive: first conceptual, then command, then count/approach. The final hint
  may name the command but not dictate the full sequence.
- **Avoid ambiguous characters** in beginner buffers: `l` vs `1`, `I` vs `l`, `O` vs
  `0`. Use them only when the lesson is about them.
- **Find targets** are punctuation from the safe set, not letters that are also
  editing commands. Ensure the target occurs exactly once on the line.
- **Operator notes** should state the engine's behavior when it matters (e.g. `cw`
  acts to the word end; `dd` is linewise; `p` after `yy` pastes below). Do not rely on
  remembered Vim behavior; rely on replay.
- **No solution leakage** in instructions/hints. Naming a command is fine; spelling
  out `w w` is not a hint, it is the answer.

### 9.5 Engine-dependent content while pre-1.0

- Add future content as `status: draft`. Drafts are schema/registry validated and
  compiled into the CI validation artifact but excluded from the runtime and
  curriculum.
- A draft may reference an engine version that is not published/tested. CI skips
  replay and reports `draft: engine 0.x.y not in tested matrix` rather than failing.
  Structural checks (tokens, solution subset, bounds, goal agreement) still run.
- When the engine slice publishes:
  1. Add the exact version to `TESTED_ENGINE_VERSIONS` and `compatibility.yaml`.
  2. Run the compatibility matrix.
  3. Flip the lesson/template/skill to `active`.
  4. Bump the content version (minor while 0.x) and publish.
- Do not activate an object whose `engine` range includes an untested version. The
  compiler fails active templates that are not satisfied by every tested version.
- Do not merge active content that depends on uncommitted engine behavior. If the
  behavior is not in a published engine version, it is draft.
- If the engine changes a command's behavior in a way that breaks a template, the
  template is updated (or retired) in a content release. The engine's version range
  and the compatibility matrix make this visible.

### 9.6 License and contribution policy

- MIT. Contributions are accepted under the MIT license.
- DCO sign-off (`git commit -s`), no CLA. This keeps contributions open and simple.
- One maintainer approval plus green CI for content changes. Release tags require a
  maintainer with npm publish rights and a protected environment.
- `SECURITY.md` explains private vulnerability reporting. Content is data, but the
  parser, generator, and build scripts are in scope.
- Code of conduct/moderation is an M6 community concern. M1 reviews content for
  offensive or unsafe material; there is no runtime user-generated content.

---

## 10. Security and abuse

Content is public and community-contributed. The threat model is malicious or
accidental YAML, not a trusted plugin ecosystem.

| Threat | Control |
|---|---|
| Executable lesson code | Data-only YAML; no eval/new Function/dynamic import; no custom tags; interpreter is reviewed maintainer code |
| YAML bombs / parser abuse | 64 KiB per file, 2 MiB total; no anchors/aliases; duplicate keys rejected; shallow schema; no custom tags |
| Prototype pollution | Strict schemas reject unknown keys; compiled objects are constructed from known fields, never raw spreads; `__proto__`/`constructor` keys rejected |
| Path traversal | Build tools only read matching paths under `content/`/`registry/`; no symlinks; runtime never reads files |
| Unbounded generation | 32 ops, 32 picks, 12×100 buffers, 64-key solutions, no retries/recursion; app rate limits |
| Network/fs/time/locale | Runtime has no such APIs; bundle/lint checks reject them; no environment-dependent output |
| Randomness abuse | Only mulberry32 with server-chosen seeds; no crypto/security claim; replay validates outcomes |
| Supply chain | Zero runtime deps; pinned devDeps/lockfile; npm provenance; no lifecycle scripts; file whitelist; exact app pins + integrity hashes |
| Secret leakage | No secrets in content; CI secret scan; repo is public by design |
| Solution leakage | Reference solutions are not in the published artifact; start responses cannot contain them |
| XSS via prose | Prose is plain text; app must render as text, never `dangerouslySetInnerHTML`; lesson prose cannot contain HTML/URLs |
| Denial via huge content | Bounds above; compilation/enumeration CI caps; app request caps |
| Malicious engine range | Restricted/narrow ranges; exact tested list; boot check; no runtime branching |

Why the app can trust the package:

1. **It is data plus a small reviewed interpreter.** No I/O, network, clock,
   randomness, or code generation.
2. **It is published with provenance and pinned exactly.** The app's lockfile carries
   the integrity hash; the boot check enforces the version matrix.
3. **Its correctness is mechanically checked.** Every active template is replayed
   against every tested engine version, with goal/par/allowed/determinism checks.
4. **Its published artifact excludes answers.** Reference solutions and YAML never
   enter the tarball.
5. **The app keeps its own defenses.** It enforces allowed keys, caps, TTL, ownership,
   single submit, and server-side replay. Content never replaces those.

The app MUST NOT:

- Value-import content into the client in M1.
- Trust a client-provided goal, par, template ID, or instance; it regenerates from the
  stored seed/template/versions.
- Render lesson prose as HTML.
- Skip the allowed-key check because the engine recognizes a key.
- Serve with an engine version outside `TESTED_ENGINE_VERSIONS`.

---

## 11. Testing and release flow

### 11.1 Release order

```
engine publishes @vim-villain/engine@x.y.z
        │
        ▼
content adds x.y.z to tested matrix, runs replay, publishes @vim-villain/content@a.b.c
        │
        ▼
app bumps exact pins, runs integration tests, boots, deploys
```

The order is not advisory. Content's tested list is the compatibility gate; the app's
boot check is the enforcement. Engine and content publish semver tags; the app
publishes a private image.

### 11.2 Cutting a content release

1. Ensure `main` is green and the registry/CHANGELOG are updated.
2. Bump `package.json.version` per §7.4. Runtime changes need a bump; draft-only
   changes do not.
3. Open a release PR with the CHANGELOG entry, build ID, tested engine versions, and
   ID changes. CI runs the full suite plus the compatibility matrix.
4. Merge, then tag `vX.Y.Z` on the merge commit. The release workflow verifies the tag
   equals the package version.
5. Build from a clean checkout, run the full suite and matrix, `npm pack --dry-run`,
   and publish with provenance.
6. Create a GitHub release with: content version, build ID, tested engine versions,
   active counts, added/changed/retired IDs, and "open attempts expire on deploy."
7. Post-publish smoke: install the published tarball in a clean temp project with each
   tested engine; call `getCurriculum`, `getLesson`, and `startLesson` for every active
   lesson with a fixed seed; compare generation to the repo's fixtures; replay the
   repo's reference solution and assert the goal. If this fails, deprecate immediately
   and publish a fix; the app must not adopt.

### 11.3 Adopting an engine bump

1. Engine publishes.
2. Content PR adds the exact version to `compatibility.yaml`/`TESTED_ENGINE_VERSIONS`.
   Widening the peer range is derived; check `package.json`.
3. Run the matrix. Fix any template whose behavior changed; if a command changed
   incompatibly, decide whether to fix, retire, or raise the floor.
4. Publish a content release (patch if the runtime payload is unchanged and only
   support widens; minor if content changes or the floor moves in a consumer-visible
   way).
5. App PR bumps engine and content pins together, runs integration tests, and
   deploys. The app's supported matrix records the pair. Open attempts expire.

An app MUST NOT adopt a new engine version without a content release that lists it.
An app MUST NOT adopt a content version whose tested list does not include its engine.

### 11.4 Hotfixing a broken template

1. Reproduce with the seed/template/engine/content version from the report. The
   attempt data has the seed; the report should include the attempt ID.
2. Add the seed to `tests/fixtures/seeds.json` under `regression` so the bug is
   permanent.
3. Fix the template (goal, solution, pool constraint, allowed set, or prose). Run the
   full suite and matrix.
4. Bump the content version. A fix that changes generation/goal/allowed/par is a
   runtime change (minor while 0.x); a byte-identical internal refactor may be a patch.
5. Publish; the app deploys and expires open attempts. If the fix cannot land quickly,
   retire the template/lesson in a release (status retired, file removed, registry
   keeps the ID). The lesson disappears; skill progress remains. A replacement gets a
   new variant ID.

There is no emergency content kill switch in the app's M1 design. Content retirement
requires a deploy. If instant disabling becomes an operational requirement, the app
needs a lesson kill switch/config override; that is an app feature, not a content
change. See §11.7.

### 11.5 Rollback and deprecation

- **Rollback:** the app rolls back to the previous image/pins. The previous content
  version remains on npm. Open attempts created under the bad version are expired.
- **Do not unpublish.** npm unpublish is time-limited, breaks pins, and is not a
  rollback strategy. Publish a fix or deprecate the bad version with a message.
- **Deprecation:** `npm deprecate @vim-villain/content@a.b.c "reason; upgrade to
  a.b.d"`. The app pins exact versions and will not auto-upgrade.
- **Broken release:** if the post-publish smoke fails, deprecate immediately, publish
  a patch that restores the previous behavior, and tell the app not to adopt. If the
  app already adopted, roll back the app image.

### 11.6 Release handshake with app and engine

| Party | Responsibility |
|---|---|
| Engine | Publish immutable semver; document behavior changes/divergences; keep the contract stable within its policy |
| Content | Declare the exact tested engine list; prove every active template on every tested version; publish immutable content semver with provenance; list ID changes |
| App | Pin exact versions; boot-check the engine/content matrix and schema; expire open attempts on version change; enforce allowed keys and replay; render prose as text |

Content's release notes are the handshake artifact. There is no private CI dependency
from content to app. The app's CI installs the published content/engine versions and
runs its own integration tests. If the app needs a content change, content publishes
first; the app pins after.

### 11.7 Operational open item

The app has no M1 lesson kill switch. Content retirement requires a content release
and an app deploy. If operations needs instant disable (e.g. a harmful lesson title),
the app should add a config-level lesson denylist. This is out of scope for content but
is recorded here because it affects hotfix time. Trigger: first production content
incident.

---

## 12. Decisions

Content decision numbers (`C1`–`C24`) are local to this repo and do not share a
namespace with `app/ARCHITECTURE.md`'s `D` numbers.

### Index

| # | Decision | Status | Product fork |
|---|---|---|---|
| C1 | Independent MIT repo, npm package, engine peer | accepted | no |
| C2 | Universal ESM runtime, zero runtime deps, client type-only | accepted | no |
| C3 | YAML authoring, build-time compilation, no runtime fs/YAML | accepted | no |
| C4 | Published artifact is active runtime only; no solutions/drafts/registry | accepted | no |
| C5 | Small stable API; lookups null, generation typed errors | accepted | no |
| C6 | Seed/slug exactness and ContentError contract | accepted | no |
| C7 | Immutable IDs with path-derived allocation and registry | accepted | no |
| C8 | Flat lesson IDs; slugs derived and permanent; group is metadata | accepted | no |
| C9 | Strict ASCII/bounded schema; code-point columns | accepted | no |
| C10 | Data-only pick/line/buffer generator DSL | accepted | no |
| C11 | Pinned hash32+mulberry32; version not in the stream | accepted | no |
| C12 | Build-time constraint resolution; no runtime retries | accepted | no |
| C13 | Fixed literal solutions with generated text; par = length; no derived solutions | accepted | no |
| C14 | Allowed keys are a safety toolset, not a forced path | accepted | no |
| C15 | Exact cursor/buffer goals; no mode; app uses `isGoalSatisfied` | accepted | no |
| C16 | Groups → skills → lessons; skill prerequisite DAG; no M1 gating | accepted | no |
| C17 | Deterministic per-lesson template selection; templates hidden | accepted | no |
| C18 | Content semver + build ID + schema version; runtime changes bump | accepted | no |
| C19 | Every active template works on every tested engine version | accepted | no |
| C20 | Staged validation/CI with replay, determinism, API, pack checks | accepted | no |
| C21 | Draft-first incremental content; activate per engine slice | accepted | no |
| C22 | Data-only security posture; zero deps; provenance; defense in depth | accepted | no |
| C23 | Engine → content → app release flow; tag publish; hotfix/rollback | accepted | no |
| C24 | MIT + DCO; ASCII/prose style; pre-1.0 engine discipline | accepted | no |

### C1 — Independent MIT repo, npm package, engine peer

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — `app/ARCHITECTURE.md` defines three independent repos; content is public
MIT, published as `@vim-villain/content`, and depends on the engine as a peer. The app
consumes published packages only.

**Decision** — Create `vim-villain/content` as its own git repo with MIT license, npm
package `@vim-villain/content`, ESM-only, peer `@vim-villain/engine`, and no runtime
dependencies. The local workspace link is a development convenience only.

**Alternatives considered** — A monorepo (rejected by D1); a source-only repo consumed
via git (rejected: no semver, no provenance, fragile app pins).

**Consequences** — Independent CI/release; the app pins exact versions; content must
publish before the app can adopt; no relative imports across repos.

**Open items** — None.

### C2 — Universal ESM runtime, zero runtime deps, client type-only

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — Content must run under Bun on the server without runtime filesystem
access. The client may import types but must not generate challenges.

**Decision** — The runtime is universal (browser-safe) ESM with zero runtime
dependencies. It uses only ECMAScript, has no Node/DOM APIs, and is bundled from
precompiled data. The app client may only type-import it; value imports are an app
build error.

**Alternatives considered** — Server-only with Node APIs (rejected: no benefit, loses
future browser reuse); shipping runtime content to the client (rejected: bundle size,
server source of truth).

**Consequences** — Enforced by `lib: ES2022`/`types: []` and a browser bundle check;
the app must enforce the type-only rule; no runtime YAML/Zod/fs.

**Open items** — None.

### C3 — YAML authoring, build-time compilation, no runtime fs/YAML

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — Authors need a readable format; the server must not depend on runtime
filesystem access; generation must be deterministic and cheap.

**Decision** — YAML is authoring-only. A strict build step parses, validates, resolves
pools/presets/constraints, and emits a frozen runtime module. The published package
contains compiled JS, never YAML.

**Alternatives considered** — Runtime YAML parsing (rejected: fs, cold start,
parser dependency); JSON authoring (rejected: comments/multiline prose are worse);
committed generated TS (rejected: drift/noise).

**Consequences** — Codegen is required before typecheck/test/build; the generated
module is gitignored; the build is deterministic and hashable.

**Open items** — None.

### C4 — Published artifact is active runtime only; no solutions/drafts/registry

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — Start responses must never contain reference keys; draft content must
not leak; the package should be auditable and small.

**Decision** — The npm tarball contains `dist` plus docs only. It contains active
content, never reference solutions, draft/retired content, the registry, pools,
presets, schemas, tests, or scripts. Reference solutions live in the repo YAML and a
CI-only validation artifact.

**Alternatives considered** — Include solutions but never expose them (rejected:
accidental-leak risk); include YAML for transparency (rejected: runtime parser
temptation, size).

**Consequences** — A future "show solution" feature needs a new explicit API/decision;
the app cannot serialize an answer because it does not have one; the tarball is small.

**Open items** — None (O6 resolved: solutions are stripped).

### C5 — Small stable API; lookups null, generation typed errors

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — The app needs curriculum, lesson/skill lookup, generation, judging, and
version metadata. Everything else is internal.

**Decision** — Export `getCurriculum`, `getLesson`, `getLessonById`, `getSkill`,
`getSkills`, `startLesson`, `generateInstance`, `isGoalSatisfied`, `isContentError`,
`ContentError`, constants, and `CONTENT_INFO`. Lookups return `null`; generation
throws `ContentError`. No deep exports.

**Alternatives considered** — A generic repository interface (rejected: over-
abstraction); returning result unions everywhere (rejected: noisy for server code);
exposing template lookup (rejected: leaks composition/answers).

**Consequences** — Stable semver surface; internal refactors are free; the app maps
errors to HTTP; no template introspection.

**Open items** — Confirm the app uses `isGoalSatisfied` rather than duplicating
semantics (Appendix G4).

### C6 — Seed/slug exactness and ContentError contract

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — Determinism depends on canonical seed strings; URL behavior depends on
exact slugs; the app needs stable error codes.

**Decision** — Seeds are 16–64 lowercase hex chars, no normalization. Slugs are exact,
case-sensitive, no decoding inside content. Error codes are `UNKNOWN_LESSON`,
`UNKNOWN_TEMPLATE`, `INVALID_SEED`, `NO_ACTIVE_TEMPLATE`, `GENERATION_FAILED`.
`ContentError.details` never includes solutions.

**Alternatives considered** — Any string seed (rejected: normalization ambiguity);
case-insensitive slugs (rejected: identity ambiguity); generic `Error` (rejected: app
mapping by message is fragile).

**Consequences** — The app generates 32 hex chars; 404/500 mapping is stable;
malformed input is explicit.

**Open items** — None.

### C7 — Immutable IDs with path-derived allocation and registry

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — D10 requires permanent IDs independent of titles; progress and attempts
must never dangle; contributors need an obvious allocation rule.

**Decision** — IDs are path-derived, authored explicitly, and checked for equality.
A committed `registry/ids.yaml` records every ID with kind/status. Active/retired IDs
are never removed, renamed, or reused; draft IDs that were never active may be
replaced. Slugs are derived from lesson IDs and checked globally.

**Alternatives considered** — Free-form IDs (rejected: drift/reuse); database-managed
IDs (rejected: content is the source of truth); a generated registry (rejected:
reviewability).

**Consequences** — File moves that change IDs are breaking; active IDs are permanent;
the registry is the audit record; CI blocks reuse.

**Open items** — None.

### C8 — Flat lesson IDs; slugs derived and permanent; group is metadata

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — Lessons may be re-grouped as the curriculum evolves. Baking the group
into the lesson ID would make a presentation change an identity break.

**Decision** — Lesson IDs are `lesson.<slug>`; templates are
`template.<slug>.<variant>`. The group lives in metadata/path only. Skill IDs keep the
group (`skill.<group>.<name>`) because a skill is a taxonomy node. Slugs are permanent
once active and never reused.

**Alternatives considered** — `lesson.<group>.<slug>` (rejected: re-grouping breaks
identity); random IDs (rejected: unreadable); slug aliases (rejected for M1: extra
lookup state without a product need).

**Consequences** — Re-grouping a lesson is a metadata/path move, not an ID change;
renaming a slug creates a new lesson; URLs are stable; retired slugs remain reserved.

**Open items** — None.

### C9 — Strict ASCII/bounded schema; code-point columns

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — The engine uses a fixed ASCII word class and code-point columns; lesson
bug reports are hard to diagnose if content behaves differently across runtimes.

**Decision** — All authored content is printable ASCII; buffers have no tabs/newlines;
YAML is strict, single-document, no aliases/custom tags. Buffers/keys/solutions have
hard size caps. Columns are code-point indices; the interpreter counts code points even
though M1 content is ASCII.

**Alternatives considered** — Allow UTF-8 buffer text (rejected: word-motion semantics
and column confusion); allow tabs (rejected: rendering/indent ambiguity); unbounded
buffers (rejected: replay/generation cost).

**Consequences** — Content is English/lowercase-oriented in M1; non-ASCII is a future
schema/policy change; validation is strict and predictable.

**Open items** — O8.

### C10 — Data-only pick/line/buffer generator DSL

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — D9 requires declarative content and deterministic generation; arbitrary
lesson code is forbidden; authors need variety without a programming language.

**Decision** — Exactly three ops: `pick` from a static pool, `line` from named parts
with spans, `buffer` from lines. Refs are flat; no expressions, interpolation,
conditionals, loops, arithmetic, or transforms. Named spans drive derived goals.

**Alternatives considered** — A string-template expression language (rejected:
parsing/sandbox/edge cases); JSON Schema-driven generators (rejected: less readable);
allowing JS snippets (rejected: security/code review).

**Consequences** — Generation is trivially bounded and auditable; lexical variety
only; structural variation needs a new op/version; goals are exact and derived.

**Open items** — None.

### C11 — Pinned hash32+mulberry32; version not in the stream

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — D9 mandates mulberry32; determinism must hold across runtimes and
releases; the app keys attempts by `(template_id, seed, content_version)`.

**Decision** — Pin a 32-bit xmur3-finalized string hash and mulberry32 returning
uint32. Domain-separate select/generate/enumerate streams. Hash inputs are
`domain\0id\0seed`; `contentVersion` is not in the hash. The version identifies which
function produced an instance, not a salt.

**Alternatives considered** — Include contentVersion in the seed (rejected: reshuffles
unchanged templates, weakens cross-version comparison); `Math.random`/crypto
(rejected: nondeterministic/dependency); a numeric seed only (rejected: API less
opaque).

**Consequences** — Same template+seed is stable across releases if unchanged; changed
templates change under the same seed and require a version bump; cross-runtime tests
pin vectors.

**Open items** — None.

### C12 — Build-time constraint resolution; no runtime retries

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — Rejection sampling at runtime can loop and fail for some seeds; content
bugs should be caught before publish.

**Decision** — Pools are static; constraints filter at build time; the compiled
template inlines the filtered pool. The compiler checks pool size ≥ pick count. The
runtime never filters or retries. Pick algorithms consume a fixed number of draws.

**Alternatives considered** — Runtime filtering/retry (rejected: unbounded/bug-prone);
constraint-free pools (rejected: insufficient control); precomputing all instances
(rejected: combinatorial size).

**Consequences** — Generation cannot fail for a valid compiled template; pool changes
are versioned; authors get compile-time errors instead of production failures.

**Open items** — None.

### C13 — Fixed literal solutions with generated text; par = length; no derived solutions

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — The app's model says each template has a reference solution and par, and
CI replays it. Generated text makes a naive fixed solution fragile.

**Decision** — M1 solutions are literal token sequences, fixed for every instance.
Templates vary text only along dimensions that preserve the solution's semantics
(static structure, homogeneous word pools, unique find targets, fixed typed text).
Par is the solution length; it is a benchmark, not an optimum. Per-instance solution
derivation is out of scope.

**Alternatives considered** — Per-instance derived solutions (rejected: second DSL,
variable par, allowed-set complexity); generated typed text (rejected: solution would
vary, violating the fixed-solution contract); literal-only buffers (rejected: no
variety).

**Consequences** — Solutions can be stripped from the runtime artifact; CI can
enumerate/sample and replay one fixed sequence; authors must prove invariance; par
cannot express variable-length answers.

**Open items** — O4 (history/visual path not enforced); M3 efficiency > 100%.

### C14 — Allowed keys are a safety toolset, not a forced path

Status: accepted · Date: 2026-11-17 · Product fork: no (resolved with O3)

**Context** — The app fails an attempt containing a disallowed key. If content allows
only the taught key, a learner who uses another valid motion fails despite reaching
the goal. If content allows everything, movement lessons can be edited.

**Decision** — Allowed sets are safety boundaries: motion-only for `move-to-target`
(enforced by `MOTION_TOKENS`), relevant edit/correction commands for `edit-to-match`.
They permit alternative valid paths; they do not force the reference path. The lesson
prose/legend teach the intended path; par benchmarks it.

**Alternatives considered** — Minimal per-lesson sets (rejected: false failures and
frustration); permissive all-keys (rejected: edits/cheats in movement); per-attempt
dynamic sets (rejected: no need, more surface).

**Consequences** — Learners can beat par or bypass the taught command; mastery must
handle it; movement cannot edit; edit lessons are forgiving. A product owner may
tighten specific lessons.

**Open items** — O4; M3 mastery formula. O1 is resolved (first publish scope).

### C15 — Exact cursor/buffer goals; no mode; app uses `isGoalSatisfied`

Status: accepted · Date: 2026-11-17 · Product fork: no (resolved with O3)

**Context** — D13 defines `move-to-target` (final cursor equals target) and
`edit-to-match` (final buffer equals target). The app must judge the final state; goal
semantics should live once.

**Decision** — Goals are exactly a cursor position or an exact buffer array. No mode
field, no tolerance, no partial credit. Content exports `isGoalSatisfied`; the app
calls it with the final engine state. `move-to-target` is protected by motion-only
allowed keys rather than a mode condition.

**Alternatives considered** — Add `finalMode: normal` (rejected for M1: contradicts
the app's stated pass condition and needs an app change); app-side judging duplicated
(rejected: drift); region/tolerance goals (rejected by D13).

**Consequences** — Goal semantics are single-sourced; the app must delegate; a
move-to-target attempt cannot enter insert mode because the keys are disallowed. If a
bypass is found, revisit C15's allowed-key boundary.

**Open items** — Confirm app delegation (G4). O3 is resolved.

### C16 — Groups → skills → lessons; skill prerequisite DAG; no M1 gating

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — The app exposes an ordered curriculum and keys progress by skill. It
does not have a lesson-lock table.

**Decision** — Model groups, skills, lessons, and templates. Prerequisites live on
skills as a DAG; lessons derive effective prerequisites from their skills. The API
exposes the ordered curriculum and effective prerequisites; M1 does not gate lessons.

**Alternatives considered** — Lesson-level prerequisites (rejected: progress is per
skill); a single flat lesson list (rejected: no progression metadata); gating in
content (rejected: app policy).

**Consequences** — Progress is stable across lesson reordering; the UI can recommend;
no lock state to persist; retiring a skill is avoided in M1.

**Open items** — None.

### C17 — Deterministic per-lesson template selection; templates hidden

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — `POST /lessons/:slug/attempts` passes a slug and seed, not a template ID.
A lesson may have multiple templates. The response must include a template ID for
replay.

**Decision** — Active templates are sorted by `(order, id)`. If one, select it. If
more, select with `hash32("select\0" + lessonId + "\0" + seed) % count`. Generate with
the template stream. Lesson detail/curriculum do not expose template IDs or counts.

**Alternatives considered** — App chooses/passes a template (requires an app API
change); one template per lesson (less variety); round-robin by attempt count (needs
state; not deterministic from seed).

**Consequences** — Same seed+lesson selects the same template; adding/removing a
template changes selection (version bump/expiry); templates stay hidden; racing can
pin a template via `generateInstance`.

**Open items** — O5 (whether to allow multi-template lessons initially).

### C18 — Content semver + build ID + schema version; runtime changes bump

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — The app records `content_version` for affinity and expires open attempts
on change. Content needs a human version and an integrity fingerprint.

**Decision** — `CONTENT_VERSION` is package semver. `CONTENT_BUILD_ID` is a SHA-256 of
the runtime payload + generator/schema versions; compatibility metadata is deliberately
excluded so support-only releases keep the same fingerprint. `CONTENT_SCHEMA_VERSION`
is an integer shape version. Any runtime payload change bumps the version, enforced via
build-ID comparison. Compatibility-only changes (tested list/peer range) require a
patch bump, enforced separately. Pre-1.0, minor may be breaking; patch means no runtime
change. IDs are never removed; retirement is the mechanism.

**Alternatives considered** — Content hash as the attempt version (rejected for M1:
app schema/ops change); semver only without a build ID (rejected: no drift detection);
calendar versions (rejected: no compatibility signal).

**Consequences** — Publishing expires open attempts; batch changes; build ID aids
forensics; schema version gates the app; npm immutability is the contract.

**Open items** — O7.

### C19 — Every active template works on every tested engine version

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — Content runs engine-version-agnostically; the app starts any active
lesson without passing an engine version. If a template required a newer engine than
the tested floor, it could fail in production.

**Decision** — `TESTED_ENGINE_VERSIONS` is exact, ascending, contiguous by minor. Every
active template's `engine` range must include every tested version. CI replays all
active templates on all tested versions. The peer range is derived and narrow; the app
boot-checks exact membership. Content never branches on engine version.

**Alternatives considered** — Per-template engine filtering at runtime (requires an
app API change); open-ended peer range (rejected: untested/behavioral risk); trust
semver minor compatibility (rejected pre-1.0).

**Consequences** — Adding a new engine slice raises the content floor; the app upgrades
engine first; a template that needs a new command stays draft until the whole active
set is compatible; releases are tightly coupled to engine versions.

**Open items** — Appendix G2 (engine 0.x policy).

### C20 — Staged validation/CI with replay, determinism, API, pack checks

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — Content correctness is the product's correctness; a bad template can
make a lesson unsolvable or leak an answer.

**Decision** — Ordered pipeline: source hygiene, schema, registry/identity, graph,
compile, generation/replay, determinism/goldens, public API, browser/pack, version
discipline, links/prose, compatibility matrix. Structured errors with file/pointer/
code/hint. Golden fixtures use version-independent generation subjects.

**Alternatives considered** — Unit tests only (rejected: misses instance/goal bugs);
app-side integration only (rejected: too late); snapshotting full instances with
versions (rejected: churn).

**Consequences** — Slow CI is justified; contributors get actionable errors; every
active template is proven on every supported engine; goldens make output changes
reviewable.

**Open items** — None.

### C21 — Draft-first incremental content; activate per engine slice

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — The engine is pre-1.0 and lands in slices; content should be authored
ahead of the engine without shipping unplayable lessons.

**Decision** — `status: draft` content is schema/registry validated but excluded from
the runtime, curriculum, and npm tarball. It may target an unreleased engine version;
CI skips replay with a clear message. Activation requires the engine in the tested
matrix, a status flip, and a content release. Draft-only changes do not bump the
version.

**Alternatives considered** — Feature branches only (rejected: no reviewable content
corpus); shipping drafts (rejected: broken lessons); a separate draft repo (rejected:
coordination overhead).

**Consequences** — The repo can hold the full M1 plan; the published package is
always playable; activation is a release gate; draft IDs are cheap before activation.

**Open items** — None.

### C22 — Data-only security posture; zero deps; provenance; defense in depth

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — Content is public and community-contributed; the app trusts the package
to generate instances and define goals.

**Decision** — Data-only templates, reviewed interpreter, no eval/dynamic
import/network/fs/clock/locale, strict YAML, bounded sizes, zero runtime deps,
provenance, file whitelist, no lifecycle scripts. The app keeps allowed-key
enforcement, replay, caps, and TTL; prose is rendered as text.

**Alternatives considered** — Executable lesson code (rejected by D9); trusting
contributors without CI (rejected); rendering Markdown/HTML (rejected: XSS surface).

**Consequences** — Small audit surface; some expressiveness lost; the app cannot
delegate its defenses; content bugs are bounded by generation/replay limits.

**Open items** — None.

### C23 — Engine → content → app release flow; tag publish; hotfix/rollback

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — Three repos, registry versions, boot checks, and open-attempt affinity
require a strict release order.

**Decision** — Engine publishes; content adds exact tested versions, runs the matrix,
publishes from a tag with provenance; app bumps exact pins, runs integration, boots,
deploys. Hotfix by fix-forward content release; retire only if needed; rollback by app
pin/image; never unpublish. Post-publish smoke installs the tarball and replays.

**Alternatives considered** — App builds content from source (rejected by D1);
publishing from a laptop (rejected: provenance/reproducibility); unpublish/retag
(rejected: breaks pins).

**Consequences** — Slower adoption, safe compatibility; content release notes are the
handshake; open attempts expire; bad versions are deprecated, not deleted.

**Open items** — 11.7 (app-level kill switch).

### C24 — MIT + DCO; ASCII/prose style; pre-1.0 engine discipline

Status: accepted · Date: 2026-11-17 · Product fork: no

**Context** — Community contributions need a clear license, contribution model, and
style rules; the engine is pre-1.0 and evolving.

**Decision** — MIT, DCO sign-off, no CLA. ASCII-only, plain-text prose, small buffers,
progressive hints, no solution leakage. Future content is draft until its engine slice
is tested. No active content depends on unreleased behavior.

**Alternatives considered** — CLA (rejected: friction); Markdown prose (rejected:
rendering/XSS/scope); allowing non-ASCII in M1 (rejected: engine word classes).

**Consequences** — Contributions are easy to license; content is English-only in M1;
reviewers enforce style; engine changes are adopted deliberately.

**Open items** — O8.

---

## 13. Open questions

These are genuine forks. Recommendations are the defaults this document uses; they are
reversible until the trigger. A product owner may change them without invalidating the
technical architecture.

### O1 — First-release editorial scope

Status: resolved 2026-11-17 — first publish is motions + insert + operators
(14 lessons / 21 templates / 12 skills); M1 target remains 20/28/18.

**Question** — Is 9 movement lessons / 13 templates the right first release, and is 20
lessons / 28 templates the right M1 target?

**Recommendation** — Ship 14/21/12 first now that insert and operators are released;
grow to 20/28 as later engine slices land. This gives a complete beginner track
without waiting for text objects or visual mode.

**Alternatives** — 3–5 lessons (faster launch, thin curriculum); all 20/28 before launch
(delays launch, depends on unreleased engine).

**Trigger** — Before tagging `0.1.0`, or when product decides the launch curriculum.

### O2 — Hints and instructions in content or app

Status: resolved 2026-11-17 — lesson prose and progressive hints live in content.

**Question** — Should lesson prose/hints live in content, or should the app own generic
hints/UI copy?

**Recommendation** — Content. Lesson-specific instructions and progressive hints are
curriculum, not UI chrome; community contributors can improve them with the exercise.

**Alternatives** — App-owned hints (consistent tone, but content authors cannot fix a
confusing lesson); hybrid (content provides exercise text, app provides generic Vim
help).

**Trigger** — Client MVP design, or the first lesson whose prose needs app-specific
rendering.

### O3 — Does `move-to-target` require normal mode?

Status: resolved 2026-11-17 — cursor equality plus motion-only allowed keys; no
`finalMode` field.

**Question** — The app's pass condition is final cursor equality. Should content's goal
also require `mode === "normal"`? A learner could otherwise enter insert mode and reach
the column by typing (if insert keys were allowed).

**Recommendation** — Keep the app-compatible cursor-only goal for M1 and enforce
motion-only allowed keys. This prevents the known bypass without changing the app's
stated pass condition.

**Alternatives** — Add `finalMode: "normal"` to the goal and have the app check it
(small contract change; more robust); ignore (rejected: a bypass exists).

**Trigger** — A demonstrated bypass, or a decision to move goal judging fully into
content.

### O4 — History/visual lessons under final-state judging

**Question** — Final-state judging cannot force undo, redo, dot-repeat, or a visual
selection; a learner can reach the same buffer another way. Should M1 ship these
lessons?

**Recommendation** — Ship them as instructional lessons with copy that says "practice
the sequence"; par is the reference, not an enforcement. They are still valuable
guided practice. Alternatively, defer path-dependent lessons to M4 when a richer
challenge type exists.

**Alternatives** — Defer all history/visual content (cleaner judging, less coverage);
add step-by-step judging (out of scope by D13); tighten allowed keys so only the
taught path works (fragile and often impossible).

**Trigger** — Content review for the visual/history slices, or M4 challenge-type work.

### O5 — Multi-template lessons

**Question** — Should a lesson have multiple templates, or exactly one?

**Recommendation** — Support multiple with deterministic seed-based selection, but
author 1:1 initially. It gives future variety without an API change.

**Alternatives** — Enforce 1:1 (simpler selection, less variety); app chooses/passes a
template (API change, app policy); rotate by attempt count (needs state).

**Trigger** — The first lesson that wants two variants, or racing requirements.

### O6 — Reference solutions in the published artifact

Status: resolved 2026-11-17 — reference solutions are stripped from the npm artifact.

**Question** — Strip reference solutions from npm, or include them but never expose
them?

**Recommendation** — Strip. The app cannot leak what it does not have; the public repo
still contains the answers for transparency and contribution.

**Alternatives** — Include for a future "show solution" feature (simpler feature, higher
accidental-leak risk, slightly larger package); a separate `@vim-villain/content-
solutions` artifact (explicit but another package).

**Trigger** — A planned show-solution/hint feature, or an app requirement to render a
solution.

### O7 — `contentVersion` identity and attempt expiry

**Question** — Should `content_version` be the package semver, a generation hash, or
both?

**Recommendation** — Semver for attempts + build ID for integrity. It matches the app's
data model and release notes; the cost is that a presentation-only release expires open
attempts.

**Alternatives** — A generation hash as `content_version` (presentation releases don't
expire attempts, but the app loses a human version and needs a schema/contract change);
both fields in attempts (most precise, app migration).

**Trigger** — If presentation-only releases become frequent enough that expiring open
attempts is a real cost.

### O8 — Non-ASCII and localized content

**Question** — Should content allow non-ASCII buffer text or localized prose in M1?

**Recommendation** — No. The engine's word class is ASCII; non-ASCII letters would be
punctuation for `w`/`b`/`e`, which is pedagogically wrong. Keep M1 ASCII/English.

**Alternatives** — Allow non-ASCII with a per-template flag (engine semantics still
wrong); add locale-specific word classes in content (the engine owns word classes);
translate prose only (possible later; buffer text remains ASCII).

**Trigger** — Engine adds Unicode/locale-aware word classes, or product commits to
localization.

---

## Appendix A — Contract gaps and handshake notes

### Engine-contract gaps

**G1 — The engine does not export its token validator.**
`src/keys.ts` defines `SPECIAL_KEYS`, `isKeyToken`, `isPrintableKey`, and
`isControlKey`, but `src/index.ts` exports only the constants and types. Content must
duplicate the vocabulary grammar to validate YAML and allowed sets. This is a drift
risk: if the engine adds a special key or changes the grammar, content's validator can
silently diverge.

*Recommendation:* export `isKeyToken` (or a `KEY_TOKENS`/`SPECIAL_KEYS` constant) from
`@vim-villain/engine`'s root, and treat it as part of the contract slice. Content would
depend on it in CI/dev and keep a test that asserts every content token is accepted.
This is a small, additive engine change. Until then, content pins the documented
grammar and reports the duplication here.

**G2 — Engine 0.x semver policy is ambiguous for behavior changes.**
The engine README says "major: incompatible state/API/behavior changes" and "minor:
new commands, modes, or state fields that do not change existing replay outcomes." But
implementing a previously unrecognized key *does* change the outcome of a sequence
containing it, and the package is `0.x`, where semver permits breaking minors. Content
cannot tell whether `0.3.0` is guaranteed to preserve `0.2.0` outcomes for the key
sequences content uses.

*Recommendation:* the engine should state explicitly whether pre-1.0 behavior changes
bump the minor (`0.3.0`) or jump to `1.0.0`, and whether implementing a previously
unrecognized key is considered a minor feature or a behavior change. Content's
mitigation does not depend on the answer: it treats every tested minor as potentially
breaking, uses exact tested versions, and never uses an open-ended peer range. This is
conservative but forces a content release per engine minor.

**G3 — No generic goal/goal-predicate helper.**
The engine correctly knows nothing about content goals. Content owns
`isGoalSatisfied`. This is not a gap in the engine; it is recorded so the app does not
duplicate cursor/buffer equality semantics.

### App handshake notes

**G4 — Judging boundary.** `app/ARCHITECTURE.md` says the app judges the final state.
Content exports `isGoalSatisfied` as the single definition of the two challenge types.
The app SHOULD call it (or an equivalent generated from the same goal data) rather than
reimplementing buffer/cursor equality. If the app insists on judging locally, the two
implementations must be kept identical by contract tests. This is a clarification, not
a conflict.

**G5 — Start response fields.** The app document lists the rendered instance as
`buffer`, `cursor`, `goal`, `par`, plus the allowed set and both versions. Content's
`GeneratedInstance` is a superset: it also carries `lessonId`, `lessonSlug`,
`templateId`, `challengeType`, and `schemaVersion`. These are additive and useful for
the attempt record/debugging; the app may omit them from the public response or include
them. The app MUST persist `templateId`, `lessonId`, `seed`, engine version, and content
version for replay. No system-design change is required.

**G6 — Client type-only rule.** The app's client may import content types, but a value
import would bundle the runtime content dataset. Content cannot enforce this; the app's
client build/lint must. Recommended rule: allow `import type` only from
`@vim-villain/content`.

**G7 — Version affinity.** Content has no `contentVersion` parameter: the installed
package is the version. The app MUST expire open attempts when its content version
changes and MUST NOT regenerate an old attempt with a new content version. This is
already D14; it is repeated because it is the one place where content's stateless API
depends on app policy.

**G8 — Move-to-target mode bypass.** The cursor-only goal plus motion-only allowed
keys closes the obvious bypass. If the app ever loosens allowed-key enforcement or
adds a challenge type that permits insert keys in a movement lesson, revisit C15. The
app MUST NOT accept a client-provided goal/mode that bypasses the server-side goal.

**G9 — Engine slice status.** Engine 0.4.0 publishes motions, insert mode, and the
normal-mode operators `d c y > < gu gU ~`. Text objects, visual mode, paste, remaining
edits, and history commands are not yet published. This document treats implemented
behavior only through the published contract; text-object/visual/register/history
templates remain draft until their engine version is published and tested. No content
decision depends on uncommitted engine internals.

### Conflict statement

No conflict was found that requires changing `app/ARCHITECTURE.md` or the engine
contract. The gaps above are additive recommendations (G1/G2) or handshake
clarifications (G4–G8). If the engine's 0.x policy or token vocabulary changes, content's
tested-version/compatibility design absorbs it with a content release; if the app
chooses a different judging boundary or version identity, C15/O7 record the fork.

---

## Appendix B — Quick reference

### Public API at a glance

```ts
getCurriculum(): Curriculum
getLesson(slug: string): LessonDetail | null
getLessonById(id: LessonId): LessonDetail | null
getSkill(id: SkillId): SkillDetail | null
getSkills(): readonly SkillDetail[]
startLesson(slug: LessonSlug, seed: string): GeneratedInstance
generateInstance(templateId: TemplateId, seed: string): GeneratedInstance
isGoalSatisfied(goal: Goal, state: JudgeState): boolean
isContentError(error: unknown): error is ContentError
```

### Start/submit flow

```
app chooses seed
  → startLesson(slug, seed)
      → select active template (deterministic)
      → generate instance (deterministic)
      → return buffer, cursor, goal, allowedKeys, par, IDs, versions
  → app stores attempt: seed, template_id, lesson_id, engine_version, content_version
  → browser replays with the same engine and records keys
  → submit keys
      → app checks ownership/status/expiry/key count/body/allowed keys
      → app regenerates with stored seed + template_id + installed content version
      → app replays with the stored engine version
      → isGoalSatisfied(goal, finalState)
      → pass/fail, store outcome, update skill progress
```

### Non-negotiables

1. No executable lesson code. Data only.
2. No reference keys in the published package or any API response.
3. Immutable IDs; no removal or reuse after activation.
4. Deterministic generation; pinned PRNG; bounded work.
5. Every active template works on every tested engine version.
6. No runtime filesystem, network, clock, locale, or randomness.
7. The app enforces allowed keys, caps, TTL, and replay; content never replaces them.
