# Changelog

## 0.1.0 — 2026-11-17

First publish: 14 lessons, 21 templates, and 12 skills on engine `0.4.0`.

- Package scaffold, strict YAML compiler, registry, deterministic generator, and public API.
- Target engine `>=0.4.0 <0.5.0`; tested `0.4.0`.
- Movement: character, word, big-word, line, file, find, and count lessons.
- Insert: `i`/`a` insertion, `o`/`O` line opening.
- Operators: `d` with `w` and `dd`, `c` with `w`, and `>>` indentation.
- Skills: `skill.motion.char`, `skill.motion.word`, `skill.motion.big-word`,
  `skill.motion.line`, `skill.motion.file`, `skill.motion.find`,
  `skill.motion.count`, `skill.insert.basic`, `skill.insert.lines`,
  `skill.operator.delete`, `skill.operator.change`, `skill.operator.indent`.
- Lessons: `char-moves`, `word-forward`, `word-back`, `word-end`, `big-word`,
  `line-edges`, `file-edges`, `find-char`, `counts`, `insert-basic`,
  `insert-lines`, `delete-word`, `change-word`, `indent-line`.
- Reference solutions are stripped from the published artifact.
- `edge: last` cursor spans resolve to the span end, matching the documented
  `span.end - 1` rule.

Open attempts expire on every content version change.
