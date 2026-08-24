import type { Loc } from "@congruo/core";

/** Human sentence per finding type — plain language for the punch list. */
export function summarize(type: string, evidence: unknown): string {
  const e = evidence as Record<string, unknown>;
  switch (type) {
    case "MISSING_IN_CODE":
      return (e.variantCount as number) > 0
        ? `"${e.figmaName}" exists in Figma (${e.variantCount} variant combinations) with no code equivalent`
        : `"${e.figmaName}" exists in Figma with no code equivalent`;
    case "MISSING_IN_FIGMA":
      return e.kind === "prop"
        ? `prop "${e.propName}" has no Figma equivalent`
        : `"${e.codeName}" exists in code with no Figma equivalent`;
    case "PROP_VALUES_DIVERGED": {
      const parts = [];
      const fo = e.figmaOnly as string[];
      const co = e.codeOnly as string[];
      if (fo.length) parts.push(`Figma-only: ${fo.join(", ")}`);
      if (co.length) parts.push(`code-only: ${co.join(", ")}`);
      return `${e.figmaProp} ↔ ${e.codeProp} values diverged (${parts.join("; ")})`;
    }
    case "TOKEN_MISMATCH": {
      const f = e.figmaToken as { resolvedName?: string; nativeId: string };
      const c = e.codeToken as { resolvedName?: string; nativeId: string };
      return `${e.property}: Figma uses ${f.resolvedName ?? f.nativeId} but its mapped code token ${c.resolvedName ?? c.nativeId} is not used`;
    }
    case "HARDCODED_VALUE_FIGMA":
    case "HARDCODED_VALUE_CODE": {
      const token = e.matchingToken as { resolvedName?: string } | null;
      const suffix = token?.resolvedName
        ? ` — token ${token.resolvedName} matches this value`
        : "";
      return `${e.value} hardcoded on ${e.property} (${e.occurrences}×)${suffix}`;
    }
    case "REDUNDANT_COMPONENT":
      return `near-duplicate of ${e.otherName} (name ${Math.round((e.nameSimilarity as number) * 100)}%, props ${Math.round((e.propOverlap as number) * 100)}%)`;
    case "UNUSED_PROP":
      return `prop "${e.propName}" never set across ${e.observedUsages} observed usages`;
    case "UNUSED_VARIANT":
      return `variant ${e.axis}=${e.value} never used across ${e.observedInstances} instances`;
    case "PROP_EXPLOSION":
      return `${e.combinationCount} variant combinations (threshold ${e.threshold})`;
    case "UNUSED_COMPONENT":
      return "zero instances in consumer files and zero code usages";
    case "SINGLE_FILE_ADOPTION":
      return `all ${e.usageCount} usages live in one file: ${e.file}`;
    case "DEPRECATED_STILL_USED":
      return `deprecated but still used: ${e.instanceCount} instances + ${e.usageCount} code usages across ${e.fileCount} files`;
    case "NO_STORY":
      return "no Storybook story found";
    case "PROPS_UNDOCUMENTED":
      return `props missing descriptions: ${(e.undocumented as string[]).join(", ")}`;
    case "NO_USAGE_GUIDANCE":
      return "no usage guidance found (no prose docs on either side)";
    default:
      return JSON.stringify(e);
  }
}

export function locationLink(
  loc: Loc,
  repo?: string,
): { href: string | null; label: string } {
  if (loc.kind === "figma") {
    return {
      href: `https://www.figma.com/design/${loc.fileKey}?node-id=${loc.nodeId.replace(":", "-")}`,
      label: `Figma ${loc.nodeId}`,
    };
  }
  const label = `${loc.filePath}:${loc.line}`;
  const canLink =
    repo && /^[\w.-]+\/[\w.-]+$/.test(repo) && loc.sha !== "local";
  return {
    href: canLink
      ? `https://github.com/${repo}/blob/${loc.sha}/${loc.filePath}#L${loc.line}`
      : null,
    label,
  };
}

/** Short display name from a subjectRefKey (fallback when scores lack it). */
export function refKeyName(refKey: string): string {
  const code = refKey.match(/^code:.*#(.+)$/);
  if (code?.[1]) return code[1];
  return refKey.replace(/^figma:(key|node):/, "");
}
