import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  files?: string[];
  version?: string;
};

const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "ARCHITECTURE.md",
];

let failed = false;
for (const rel of required) {
  if (!existsSync(join(root, rel))) {
    console.error(`pack: missing required file ${rel}`);
    failed = true;
  }
}

const whitelist = new Set(pkg.files ?? []);
if (!whitelist.has("dist")) {
  console.error("pack: package.json files must include dist");
  failed = true;
}
if (!(pkg.files ?? []).includes("ARCHITECTURE.md")) {
  console.error("pack: package.json files must include ARCHITECTURE.md");
  failed = true;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const forbidden = [
  /from\s+["'](?:node:)?(?:fs|path|crypto|os|child_process|process)["']/,
  /require\(\s*["'](?:node:)?(?:fs|path|crypto|os|child_process|process)["']\s*\)/,
  /"(?:solution|solutions)"\s*:/,
];
const forbiddenRuntimeOnly = [
  // Dynamic imports are forbidden in the runtime bundle. Declaration files use
  // `import("...")` type queries, so only scan JavaScript.
  /import\(\s*["']/,
];

if (existsSync(join(root, "dist"))) {
  for (const file of walk(join(root, "dist"))) {
    const isRuntime = file.endsWith(".js");
    if (!isRuntime && !file.endsWith(".d.ts")) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    const patterns = isRuntime
      ? [...forbidden, ...forbiddenRuntimeOnly]
      : forbidden;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        console.error(
          `pack: forbidden pattern ${pattern} in ${file.slice(root.length + 1)}`,
        );
        failed = true;
      }
    }
  }
}

const pack = Bun.spawnSync({
  cmd: ["npm", "pack", "--dry-run", "--json"],
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
});

if (pack.exitCode !== 0) {
  console.error(new TextDecoder().decode(pack.stderr));
  failed = true;
} else {
  const raw = new TextDecoder().decode(pack.stdout).trim();
  const parsed = JSON.parse(raw) as Record<
    string,
    { files?: Array<{ path: string }> }
  >;
  const entry = Object.values(parsed)[0];
  const files = entry?.files?.map((file) => file.path) ?? [];
  if (files.length === 0) {
    console.error("pack: npm pack returned no files");
    failed = true;
  }
  for (const file of files) {
    const top = file.split("/")[0] ?? "";
    if (
      top === "content" ||
      top === "registry" ||
      top === "tests" ||
      top === "scripts" ||
      top === "src" ||
      top === "node_modules"
    ) {
      console.error(`pack: private path leaked into tarball: ${file}`);
      failed = true;
    }
    if (!whitelist.has(top) && top !== "package.json") {
      console.error(`pack: unexpected top-level entry: ${file}`);
      failed = true;
    }
  }
  console.log(`pack: ${files.length} files would be published`);
}

if (failed) {
  process.exit(1);
}
console.log("pack: OK");
