import type {
  CanonicalExtract,
  ComponentDefinition,
  Mapping,
  PropMapping,
  TokenMapping,
} from "../model";

/** Matcher v2: exact/normalized → fuzzy (dice) with tiers. Names only PROPOSE
 * mappings — identity stays ref-based. Auto ≥0.85; suggested 0.6–0.85 surfaces
 * for human review; below stays unmatched. Never silently pair ambiguity. */

export const AUTO_THRESHOLD = 0.85;
export const SUGGEST_THRESHOLD = 0.6;

/** Workspace-configurable naming conventions. The defaults encode common
 * ecosystem conventions (DS prefixes, Icon suffixes, size synonyms) — a
 * specific design system is a configuration of these, never a code path. */
export interface MatcherConfig {
  stripPrefixes: string[];
  stripSuffixes: string[];
  valueSynonyms: [string, string][];
}

export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
  stripPrefixes: ["DS"],
  stripSuffixes: ["Icon"],
  valueSynonyms: [
    ["sm", "small"],
    ["md", "medium"],
    ["lg", "large"],
    ["xs", "extrasmall"],
    ["xl", "extralarge"],
  ],
};

const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function normalizeName(
  name: string,
  config: MatcherConfig = DEFAULT_MATCHER_CONFIG,
): string {
  let raw = name;
  for (const prefix of config.stripPrefixes) {
    const re = new RegExp(`^(${prefix})(?=[A-Z_-])`, "i");
    if (re.test(raw)) {
      raw = raw.replace(re, "");
      break;
    }
  }
  let base = clean(raw);
  for (const suffix of config.stripSuffixes) {
    const tail = clean(suffix);
    if (tail && base.length > tail.length && base.endsWith(tail)) {
      base = base.slice(0, -tail.length);
      break;
    }
  }
  return base;
}

/** Sørensen–Dice coefficient on character bigrams. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const n = bigrams.get(bg) ?? 0;
    if (n > 0) {
      hits++;
      bigrams.set(bg, n - 1);
    }
  }
  return (2 * hits) / (a.length + b.length - 2);
}

export interface MatchResult {
  proposed: Mapping[];
  /** 0.6–0.85 confidence: shown for review, never auto-applied. */
  suggested: Mapping[];
  unmatchedFigma: string[];
  unmatchedCode: string[];
}

export function proposeMappings(
  figma: CanonicalExtract,
  code: CanonicalExtract,
  config: MatcherConfig = DEFAULT_MATCHER_CONFIG,
): MatchResult {
  const codeDefs = code.definitions;
  const byNorm = new Map<string, ComponentDefinition[]>();
  for (const def of codeDefs) {
    const key = normalizeName(def.name, config);
    byNorm.set(key, [...(byNorm.get(key) ?? []), def]);
  }

  const proposed: Mapping[] = [];
  const suggested: Mapping[] = [];
  const unmatchedFigma: string[] = [];
  const matchedCode = new Set<string>();

  const pair = (
    figmaDef: ComponentDefinition,
    codeDef: ComponentDefinition,
    confidence: number,
  ): Mapping => ({
    figmaRef: figmaDef.ref,
    codeRef: codeDef.ref,
    confidence,
    source: "auto",
    propMappings: matchProps(figmaDef, codeDef, config),
  });

  // Exact tier by normalized-name groups. A code component pairs at most once:
  // when several Figma components normalize to the same code name (Polaris has
  // an icon literally named "button"), only a case-exact name wins — the rest
  // stay unmatched for human review rather than silently double-pairing.
  const figmaByNorm = new Map<string, ComponentDefinition[]>();
  for (const def of figma.definitions) {
    const key = normalizeName(def.name, config);
    figmaByNorm.set(key, [...(figmaByNorm.get(key) ?? []), def]);
  }
  const exactMatched = new Set<ComponentDefinition>();

  for (const [norm, figmaCands] of figmaByNorm) {
    const codeCands = byNorm.get(norm) ?? [];
    if (codeCands.length !== 1 || !codeCands[0]) continue; // ambiguous or none
    const codeDef = codeCands[0];
    const winner =
      figmaCands.length === 1
        ? figmaCands[0]
        : singleOrNone(figmaCands.filter((f) => f.name === codeDef.name));
    if (!winner) continue; // ambiguous — human decides
    proposed.push(
      pair(winner, codeDef, codeDef.name === winner.name ? 1 : 0.9),
    );
    matchedCode.add(codeDef.name);
    exactMatched.add(winner);
  }

  for (const figmaDef of figma.definitions) {
    if (exactMatched.has(figmaDef)) continue;
    const norm = normalizeName(figmaDef.name, config);
    if ((byNorm.get(norm)?.length ?? 0) > 1) {
      unmatchedFigma.push(figmaDef.name); // several code candidates — human decides
      continue;
    }
    // fuzzy tier over unmatched code defs
    let best: { def: ComponentDefinition; score: number } | undefined;
    for (const codeDef of codeDefs) {
      if (matchedCode.has(codeDef.name)) continue;
      const score = similarity(norm, normalizeName(codeDef.name, config));
      if (!best || score > best.score) best = { def: codeDef, score };
    }
    if (best && best.score >= AUTO_THRESHOLD) {
      proposed.push(pair(figmaDef, best.def, best.score));
      matchedCode.add(best.def.name);
    } else if (best && best.score >= SUGGEST_THRESHOLD) {
      suggested.push(pair(figmaDef, best.def, best.score));
      unmatchedFigma.push(figmaDef.name);
    } else {
      unmatchedFigma.push(figmaDef.name);
    }
  }

  const unmatchedCode = codeDefs
    .filter((d) => !matchedCode.has(d.name))
    .map((d) => d.name);
  return { proposed, suggested, unmatchedFigma, unmatchedCode };
}

function singleOrNone<T>(items: T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

/** Format-normalizes a token value so exact comparison crosses notations:
 * rgba(48,48,48,1) ≡ #303030 ≡ #303030ff; "4px" ≡ "4". Still exact — only
 * the notation changes, never the quantity. */
export function canonicalValue(raw: string): string {
  const v = raw.trim().toLowerCase();
  const rgba = v.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/,
  );
  if (rgba?.[1] && rgba[2] && rgba[3]) {
    const h = (n: number) => n.toString(16).padStart(2, "0");
    const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    const base = `#${h(Number(rgba[1]))}${h(Number(rgba[2]))}${h(Number(rgba[3]))}`;
    return alpha < 1 ? `${base}${h(Math.round(alpha * 255))}` : base;
  }
  const hex8 = v.match(/^(#[0-9a-f]{6})ff$/);
  if (hex8?.[1]) return hex8[1];
  const px = v.match(/^(-?[\d.]+)px$/);
  if (px?.[1]) return px[1];
  return v;
}

// ---- prop-level matching ----

function normalizeProp(name: string): string {
  return name
    .replace(/^(is|has)(?=[A-Z_])/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeValue(v: string, config: MatcherConfig): string {
  const n = clean(v);
  for (const [a, b] of config.valueSynonyms) {
    if (n === a) return b;
  }
  return n;
}

/** Figma variant axes + component props vs code props, by normalized name;
 * variant values map onto code literal values when they align. */
export function matchProps(
  figmaDef: ComponentDefinition,
  codeDef: ComponentDefinition,
  config: MatcherConfig = DEFAULT_MATCHER_CONFIG,
): PropMapping[] {
  const codeByNorm = new Map(
    codeDef.props.map((p) => [normalizeProp(p.name), p]),
  );
  const out: PropMapping[] = [];

  for (const [axis, values] of Object.entries(figmaDef.variants)) {
    const codeProp = codeByNorm.get(normalizeProp(axis));
    if (!codeProp) continue;
    const valueMap: Record<string, string> = {};
    for (const v of values) {
      const match = codeProp.values.find(
        (cv) => normalizeValue(cv, config) === normalizeValue(v, config),
      );
      if (match !== undefined) valueMap[v] = match;
    }
    out.push({
      figmaProp: axis,
      codeProp: codeProp.name,
      ...(Object.keys(valueMap).length > 0 ? { valueMap } : {}),
    });
  }
  for (const prop of figmaDef.props) {
    const codeProp = codeByNorm.get(normalizeProp(prop.name));
    if (codeProp) out.push({ figmaProp: prop.name, codeProp: codeProp.name });
  }
  return out;
}

// ---- token mapping proposals ----

function normalizeToken(name: string): string {
  return name
    .toLowerCase()
    .replace(/^--/, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Conservative, two exact signals only — never fuzzy-guessed:
 * 1. normalized NAME equality (when both sides have resolved names)
 * 2. exact resolved VALUE equality (when both sides know their value and it
 *    is unique on each side — #005bd3 in Figma = #005bd3 in code)
 * Tokens with neither signal surface as unassessed. */
export function proposeTokenMappings(
  figma: CanonicalExtract,
  code: CanonicalExtract,
): TokenMapping[] {
  const codeByNorm = new Map(
    code.tokens
      .filter((t) => t.ref.resolvedName)
      .map((t) => [normalizeToken(t.ref.resolvedName ?? ""), t.ref]),
  );
  const out: TokenMapping[] = [];
  const mappedFigma = new Set<string>();
  for (const t of figma.tokens) {
    if (!t.ref.resolvedName) continue;
    const codeRef = codeByNorm.get(normalizeToken(t.ref.resolvedName));
    if (codeRef) {
      out.push({
        figmaToken: t.ref,
        codeToken: codeRef,
        confidence: 0.9,
        source: "auto",
      });
      mappedFigma.add(t.ref.nativeId);
    }
  }

  const uniqueByValue = (tokens: CanonicalExtract["tokens"]) => {
    const byValue = new Map<string, (typeof tokens)[number][]>();
    for (const t of tokens) {
      const v = t.value ? canonicalValue(t.value) : undefined;
      if (!v) continue;
      byValue.set(v, [...(byValue.get(v) ?? []), t]);
    }
    return new Map(
      [...byValue.entries()]
        .filter(([, list]) => list.length === 1 && list[0])
        .map(([v, list]) => [v, (list[0] as (typeof tokens)[number]).ref]),
    );
  };
  const codeByValue = uniqueByValue(code.tokens);
  const figmaByValue = uniqueByValue(figma.tokens);
  for (const [value, figmaRef] of figmaByValue) {
    if (mappedFigma.has(figmaRef.nativeId)) continue;
    const codeRef = codeByValue.get(value);
    if (codeRef) {
      out.push({
        figmaToken: figmaRef,
        codeToken: codeRef,
        confidence: 0.85,
        source: "auto",
      });
    }
  }
  return out;
}
