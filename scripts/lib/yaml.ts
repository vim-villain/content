import { readFileSync } from "node:fs";
import { parseAllDocuments, visit } from "yaml";
import type { Collector } from "./errors.js";

export const MAX_FILE_BYTES = 64 * 1024;

/**
 * Parse a single-document, strict YAML 1.2 core file. Rejects aliases, anchors,
 * custom tags, duplicate keys, tabs, non-ASCII bytes, and oversized files.
 */
export function parseStrictYaml(
  file: string,
  relPath: string,
  collector: Collector,
): unknown {
  const bytes = readFileSync(file);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    collector.add(
      "E_YAML",
      relPath,
      "/",
      `file is ${bytes.byteLength} bytes; the limit is ${MAX_FILE_BYTES}.`,
      "split the content or shorten it.",
    );
    return undefined;
  }

  const text = bytes.toString("utf8");
  if (text.includes("\r")) {
    collector.add(
      "E_YAML",
      relPath,
      "/",
      "file contains a carriage return.",
      "use LF line endings.",
    );
  }
  if (text.includes("\t")) {
    collector.add(
      "E_YAML",
      relPath,
      "/",
      "file contains a tab character.",
      "use two spaces for indentation; tabs are forbidden in content.",
    );
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0a) {
      continue;
    }
    if (code < 0x20 || code > 0x7e) {
      collector.add(
        "E_YAML",
        relPath,
        "/",
        `file contains a non-printable-ASCII character at offset ${i}.`,
        "content must be printable ASCII (0x20-0x7E) plus LF.",
      );
      break;
    }
  }
  if (text.startsWith("\uFEFF")) {
    collector.add("E_YAML", relPath, "/", "file has a UTF-8 BOM.", "remove the BOM.");
  }

  const documents = parseAllDocuments(text, {
    schema: "core",
    uniqueKeys: true,
    prettyErrors: true,
  });

  for (const document of documents) {
    for (const error of document.errors) {
      collector.add(
        "E_YAML",
        relPath,
        "/",
        `YAML parse error: ${error.message}`,
        "fix the YAML syntax.",
      );
    }
  }

  if (documents.length === 0) {
    collector.add("E_YAML", relPath, "/", "file is empty.", "add a YAML document.");
    return undefined;
  }
  if (documents.length > 1) {
    collector.add(
      "E_YAML",
      relPath,
      "/",
      "file contains more than one YAML document.",
      "one object per file; remove the '---' separators.",
    );
  }

  const document = documents[0];
  if (document === undefined) {
    return undefined;
  }

  let rejected = false;
  visit(document, {
    Alias() {
      if (!rejected) {
        collector.add(
          "E_YAML",
          relPath,
          "/",
          "YAML aliases are not allowed.",
          "write the value out in full; anchors and aliases are forbidden.",
        );
        rejected = true;
      }
    },
    Node(_key, node) {
      if (node.anchor !== undefined && node.anchor !== null && !rejected) {
        collector.add(
          "E_YAML",
          relPath,
          "/",
          "YAML anchors are not allowed.",
          "write the value out in full; anchors and aliases are forbidden.",
        );
        rejected = true;
      }
      const tag = node.tag;
      if (
        typeof tag === "string" &&
        tag !== "" &&
        !tag.startsWith("tag:yaml.org,2002:")
      ) {
        collector.add(
          "E_YAML",
          relPath,
          "/",
          `custom YAML tag "${tag}" is not allowed.`,
          "use plain YAML core-schema values.",
        );
        rejected = true;
      }
    },
  });

  return document.toJS();
}

/** Assign a stable JSON Pointer-ish path for diagnostics. */
export function pointer(...segments: Array<string | number>): string {
  if (segments.length === 0) {
    return "/";
  }
  return `/${segments
    .map((segment) => String(segment).replace(/~/g, "~0").replace(/\//g, "~1"))
    .join("/")}`;
}
