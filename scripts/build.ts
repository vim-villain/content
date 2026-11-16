import { rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(root, "src", "index.ts")],
  outdir: dist,
  // Browser target is the strictest universal check: it rejects Node built-ins.
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "none",
  splitting: false,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const tsc = Bun.spawnSync({
  cmd: [process.execPath, "x", "tsc", "-p", "tsconfig.build.json"],
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});

if (tsc.exitCode !== 0) {
  process.exit(tsc.exitCode ?? 1);
}

console.log("build: dist/index.js and declarations written");
