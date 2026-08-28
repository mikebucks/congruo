import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Token definition files resolved to name → value. Formats:
 * - "css": custom properties (--name: value;)
 * - "json": nested objects flattened to dotted paths; Tokens Studio's
 *   {value} leaves supported
 * - "token-ts": 'name': { value: '...' } pairs (polaris-tokens style) */
export interface TokenValuesSource {
  glob: string;
  format: "css" | "json" | "token-ts";
  /** Prefixes stripped from a code token's name before lookup, e.g. "--p-". */
  stripPrefixes?: string[];
}

export function loadTokenValues(
  rootDir: string,
  sources: TokenValuesSource[] | undefined,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const source of sources ?? []) {
    const texts = globSync(source.glob, { cwd: rootDir })
      .sort()
      .map((file) => readFileSync(join(rootDir, file), "utf8"));
    if (source.format === "css") {
      for (const text of texts) parseCss(text, values);
    } else if (source.format === "json") {
      for (const text of texts) parseJson(text, values);
    } else {
      parseTokenTs(texts, values);
    }
  }
  return values;
}

/** Best-effort lookup for a code token reference name against the value map:
 * exact, dashes stripped, configured prefixes stripped, last dotted segment. */
export function resolveTokenValue(
  nativeId: string,
  values: Map<string, string>,
  sources: TokenValuesSource[] | undefined,
): string | undefined {
  const candidates = [nativeId, nativeId.replace(/^--+/, "")];
  for (const source of sources ?? []) {
    for (const prefix of source.stripPrefixes ?? []) {
      if (nativeId.startsWith(prefix)) {
        candidates.push(nativeId.slice(prefix.length));
      }
    }
  }
  if (nativeId.includes(".")) {
    // try every dotted suffix: theme.zIndex.z-index-11 → zIndex.z-index-11 → z-index-11
    const parts = nativeId.split(".");
    for (let i = 1; i < parts.length; i++) {
      candidates.push(parts.slice(i).join("."));
    }
  }
  for (const c of candidates) {
    const hit = values.get(c);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function parseCss(text: string, out: Map<string, string>): void {
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = m[1];
    const value = m[2]?.trim();
    if (name && value && !out.has(name)) out.set(name, value);
  }
}

function parseTokenTs(texts: string[], out: Map<string, string>): void {
  // pass 1: literal scale maps (colors.ts: gray: { 1: 'rgba(...)' })
  const scales = new Map<string, Map<string, string>>();
  for (const text of texts) {
    for (const block of text.matchAll(
      /export const (\w+)[^={]*=\s*\{([\s\S]*?)\n\};/g,
    )) {
      const scaleName = block[1];
      const body = block[2];
      if (!scaleName || !body) continue;
      const entries = new Map<string, string>();
      for (const e of body.matchAll(
        /['"]?([\w-]+)['"]?:\s*['"]([^'"]+)['"]/g,
      )) {
        if (e[1] && e[2]) entries.set(e[1], e[2]);
      }
      if (entries.size > 0) scales.set(scaleName, entries);
    }
  }
  for (const text of texts) {
    // literal values: 'motion-duration-0': { value: '0ms' }
    for (const m of text.matchAll(
      /['"]([\w-]+)['"]\s*:\s*\{\s*value:\s*['"]([^'"]+)['"]/g,
    )) {
      const name = m[1];
      const value = m[2];
      if (name && value && !out.has(name)) out.set(name, value);
    }
    // scale references: 'color-bg': { value: colors.gray[6] }
    for (const m of text.matchAll(
      /['"]([\w-]+)['"]\s*:\s*\{\s*value:\s*\w+\.(\w+)\[['"]?(\w+)['"]?\]/g,
    )) {
      const name = m[1];
      const value = m[2] && m[3] ? scales.get(m[2])?.get(m[3]) : undefined;
      if (name && value && !out.has(name)) out.set(name, value);
    }
  }
}

function parseJson(text: string, out: Map<string, string>): void {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return;
  }
  const walk = (node: unknown, path: string[]): void => {
    if (node === null || typeof node !== "object") {
      if (path.length > 0 && !out.has(path.join("."))) {
        out.set(path.join("."), String(node));
      }
      return;
    }
    const obj = node as Record<string, unknown>;
    // Tokens Studio leaf: { value: ..., type: ... }
    if ("value" in obj && typeof obj.value !== "object") {
      if (path.length > 0 && !out.has(path.join("."))) {
        out.set(path.join("."), String(obj.value));
      }
      return;
    }
    for (const [key, child] of Object.entries(obj)) {
      walk(child, [...path, key]);
    }
  };
  walk(root, []);
}
