import type { CanonicalExtract, Mapping } from "../model";

/** WP1.4 matcher v1: exact + normalized-name proposals. Names only PROPOSE
 * mappings — identity stays ref-based. Fuzzy tier and prop/token matching
 * arrive in WP2.3. */

export const AUTO_THRESHOLD = 0.85;

export function normalizeName(name: string): string {
  return name
    .replace(/^(DS|Ds|ds)(?=[A-Z_-])/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export interface MatchResult {
  proposed: Mapping[];
  unmatchedFigma: string[];
  unmatchedCode: string[];
}

export function proposeMappings(
  figma: CanonicalExtract,
  code: CanonicalExtract,
): MatchResult {
  const codeByName = new Map<string, (typeof code.definitions)[number][]>();
  for (const def of code.definitions) {
    const key = normalizeName(def.name);
    codeByName.set(key, [...(codeByName.get(key) ?? []), def]);
  }

  const proposed: Mapping[] = [];
  const unmatchedFigma: string[] = [];
  const matchedCode = new Set<string>();

  for (const figmaDef of figma.definitions) {
    const candidates = codeByName.get(normalizeName(figmaDef.name)) ?? [];
    // exactly one normalized-name match = confident; ambiguity stays unmatched
    const single = candidates.length === 1 ? candidates[0] : undefined;
    if (single) {
      const exact = single.name === figmaDef.name;
      proposed.push({
        figmaRef: figmaDef.ref,
        codeRef: single.ref,
        confidence: exact ? 1 : 0.9,
        source: "auto",
        propMappings: [],
      });
      matchedCode.add(single.name);
    } else {
      unmatchedFigma.push(figmaDef.name);
    }
  }

  const unmatchedCode = code.definitions
    .filter((d) => !matchedCode.has(d.name))
    .map((d) => d.name);
  return { proposed, unmatchedFigma, unmatchedCode };
}
