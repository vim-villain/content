import { readdirSync, lstatSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Collector } from "./errors.js";
import { parseStrictYaml } from "./yaml.js";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const CONTENT_DIR = join(REPO_ROOT, "content");
export const REGISTRY_FILE = join(REPO_ROOT, "registry", "ids.yaml");

export interface RawEntry {
  /** Absolute path. */
  file: string;
  /** Repo-relative path with forward slashes. */
  rel: string;
  data: unknown;
}

export interface RawSkill extends RawEntry {
  group: string;
  name: string;
}

export interface RawLesson extends RawEntry {
  group: string;
  slug: string;
}

export interface RawTemplate extends RawEntry {
  group: string;
  slug: string;
  variant: string;
}

export interface RawPool extends RawEntry {
  namespace: string;
  name: string;
}

export interface RawContent {
  groups: RawEntry | null;
  compatibility: RawEntry | null;
  presets: RawEntry | null;
  registry: RawEntry | null;
  skills: RawSkill[];
  lessons: RawLesson[];
  templates: RawTemplate[];
  pools: RawPool[];
  files: string[];
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  entries.sort();
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) {
      continue;
    }
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (stat.isFile() && entry.endsWith(".yaml")) {
      out.push(full);
    }
  }
}

/** Discover and parse all YAML under `content/` plus the registry. */
export function loadContent(collector: Collector): RawContent {
  const files: string[] = [];
  walk(CONTENT_DIR, files);
  files.push(REGISTRY_FILE);
  files.sort();

  const content: RawContent = {
    groups: null,
    compatibility: null,
    presets: null,
    registry: null,
    skills: [],
    lessons: [],
    templates: [],
    pools: [],
    files: [],
  };

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).split(sep).join("/");
    content.files.push(rel);
    const data = parseStrictYaml(file, rel, collector);
    const entry: RawEntry = { file, rel, data };

    if (rel === "content/groups.yaml") {
      content.groups = entry;
    } else if (rel === "content/compatibility.yaml") {
      content.compatibility = entry;
    } else if (rel === "content/presets/allowed-keys.yaml") {
      content.presets = entry;
    } else if (rel === "registry/ids.yaml") {
      content.registry = entry;
    } else {
      const skillMatch = /^content\/skills\/([^/]+)\/([^/]+)\.yaml$/.exec(rel);
      const lessonMatch = /^content\/lessons\/([^/]+)\/([^/]+)\/lesson\.yaml$/.exec(
        rel,
      );
      const templateMatch =
        /^content\/lessons\/([^/]+)\/([^/]+)\/templates\/([^/]+)\.yaml$/.exec(rel);
      const poolMatch = /^content\/pools\/([^/]+)\/([^/]+)\.yaml$/.exec(rel);

      if (skillMatch !== null) {
        content.skills.push({
          ...entry,
          group: skillMatch[1] as string,
          name: skillMatch[2] as string,
        });
      } else if (templateMatch !== null) {
        content.templates.push({
          ...entry,
          group: templateMatch[1] as string,
          slug: templateMatch[2] as string,
          variant: templateMatch[3] as string,
        });
      } else if (lessonMatch !== null) {
        content.lessons.push({
          ...entry,
          group: lessonMatch[1] as string,
          slug: lessonMatch[2] as string,
        });
      } else if (poolMatch !== null) {
        content.pools.push({
          ...entry,
          namespace: poolMatch[1] as string,
          name: poolMatch[2] as string,
        });
      } else {
        collector.add(
          "E_YAML",
          rel,
          "/",
          "YAML file is not in a recognized location.",
          "see CONTRIBUTING.md for the content layout.",
        );
      }
    }
  }

  if (content.groups === null) {
    collector.add(
      "E_SCHEMA",
      "content/groups.yaml",
      "/",
      "missing groups.yaml.",
      "add the content groups file.",
    );
  }
  if (content.compatibility === null) {
    collector.add(
      "E_SCHEMA",
      "content/compatibility.yaml",
      "/",
      "missing compatibility.yaml.",
      "declare engineRange and tested engine versions.",
    );
  }
  if (content.registry === null) {
    collector.add(
      "E_REGISTRY",
      "registry/ids.yaml",
      "/",
      "missing registry.",
      "record every allocated ID in registry/ids.yaml.",
    );
  }

  return content;
}
