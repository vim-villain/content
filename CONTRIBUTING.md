# Contributing

Content is the curriculum. Contributions are welcome, but exercises are data, not
code: every template is declarative YAML with a fixed reference solution.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) first. The short version:

- IDs are permanent once active. Add new IDs to `registry/ids.yaml`; never reuse one.
- Buffer text and prose are strict ASCII; use code-point columns for cursors.
- Every active template must replay to its goal on every engine version in
  `content/compatibility.yaml`'s `tested` list.
- Reference solutions stay in the repo (and `tests/generated/validation.ts`) but are
  never included in the npm artifact.

## Add a lesson

1. Pick a group from `content/groups.yaml` and a globally unique slug.
2. Create `content/lessons/<group>/<slug>/lesson.yaml`.
3. Add one or more templates under `content/lessons/<group>/<slug>/templates/`.
4. Link the lesson to its skills. Skills live at
   `content/skills/<namespace>/<name>.yaml`; the namespace is the middle segment of the
   skill ID and is independent of the presentation group.
5. Add the lesson and template IDs to `registry/ids.yaml`.
6. If the template needs new words, add or extend a pool under `content/pools/`.
7. Add goldens in `tests/goldens.ts` for two seeds.
8. Run:

```bash
bun run codegen
bun run validate
bun run typecheck
bun run test
```

## Template rules

- `move-to-target`: cursor-only goal; allowed keys must be motion tokens.
- `edit-to-match`: exact buffer goal; allowed keys may include insert/edit commands.
- `par` must equal the reference solution's token count. The solution must replay to
  the goal without clamping.
- Keep buffers small and ASCII. No tabs unless the exercise is about tabs.
- Do not put answers in lesson prose, slugs, or IDs.

## Review checklist

- [ ] IDs match paths and are registered.
- [ ] Active templates pass on every tested engine version.
- [ ] Goldens are intentional and reviewed.
- [ ] No solutions or private paths in `dist`.
- [ ] `bun run pack:check` passes.
- [ ] Prose is clear, short, and teaches the intended keys without forcing a path.

## License and sign-off

Contributions are MIT. Sign off commits with `git commit -s` (DCO).
