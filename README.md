# @vim-villain/content

Deterministic lessons, skills, and challenge templates for
[vim-villain](https://github.com/vim-villain). The package is the curriculum source
of truth: the API generates a challenge instance from a lesson slug, a template ID,
and a server-chosen seed, then judges the final state.

The design is recorded in [ARCHITECTURE.md](./ARCHITECTURE.md). Read it before adding
content or changing the runtime API.

**Status: 0.1.0 vertical slice.** Four lessons across movement, insert, and operators,
targeting `@vim-villain/engine` 0.4.0. The remaining curriculum is drafted in the
architecture and will ship as later engine slices land.

## Install

```bash
bun add @vim-villain/content @vim-villain/engine
```

The package is ESM-only and has no runtime dependencies. `@vim-villain/engine` is a
peer because the public types use its `Position` shape; the generator is deterministic
and does not need engine values.

## Use

```ts
import {
  getCurriculum,
  getLesson,
  startLesson,
  generateInstance,
  isGoalSatisfied,
} from "@vim-villain/content";

const curriculum = getCurriculum();
const lesson = getLesson("word-forward");

// The server chooses the seed and stores it with the attempt.
const instance = startLesson("word-forward", "0000000000000001");
instance.buffer;      // initial lines
instance.cursor;      // initial cursor
instance.goal;        // cursor target or target buffer
instance.allowedKeys; // keys the attempt may use
instance.par;         // reference-solution length

// Replay the submitted key log with the same engine version, then:
isGoalSatisfied(instance.goal, finalState);

// Racing / pinned-template use:
generateInstance("template.delete-word.dw", "0000000000000001");
```

Generation errors are typed:

```ts
import { ContentError, isContentError } from "@vim-villain/content";

try {
  startLesson(slug, seed);
} catch (error) {
  if (isContentError(error) && error.code === "UNKNOWN_LESSON") {
    // return 404
  }
}
```

Lookups (`getLesson`, `getSkill`) return `null`; generation throws `ContentError`.

## Authoring

Content is declarative YAML. Reference solutions live in the public repo for CI but
are stripped from the npm artifact.

```text
content/
  groups.yaml
  skills/<namespace>/<name>.yaml
  lessons/<group>/<slug>/lesson.yaml
  lessons/<group>/<slug>/templates/<variant>.yaml
  pools/<kind>/<name>.yaml
  presets/allowed-keys.yaml
  compatibility.yaml
registry/ids.yaml
```

After editing content:

```bash
bun run codegen    # validate and compile src/generated/runtime.ts
bun run validate   # schema/registry/pool checks only
bun run test       # build + unit, determinism, replay, artifact checks
bun run typecheck
```

Add the immutable IDs to `registry/ids.yaml` in the same change. IDs are permanent
once active; retire rather than remove.

## Local development

The engine is not published to npm during early development. A root workspace outside
this repo links `engine/` and `content/`:

```json
{ "private": true, "workspaces": ["engine", "content"] }
```

The committed `package.json` always uses the registry version. Do not commit a
`file:` or `workspace:*` engine dependency.

## License

MIT. See [LICENSE](./LICENSE).
