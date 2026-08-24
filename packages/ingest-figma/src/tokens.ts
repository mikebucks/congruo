import type { TokenRef } from "@congruo/core";

/** Remote (library-subscribed) variable IDs embed the variable's stable key:
 * "VariableID:<40-hex-key>/<localId>". Local ones are opaque node-style IDs.
 * See spikes/figma-variables/DECISION.md Q2. */
export function variableTokenRef(variableId: string): TokenRef {
  const remote = variableId.match(/^VariableID:([0-9a-f]{40})\//);
  return {
    nativeId: variableId,
    stableKey: remote?.[1],
    source: "figma-variable",
    resolutionConfidence: remote ? "exact" : "unresolved",
  };
}

export function styleTokenRef(
  styleId: string,
  meta: { key: string; name: string } | undefined,
): TokenRef {
  return {
    nativeId: styleId,
    stableKey: meta?.key,
    resolvedName: meta?.name,
    source: "figma-style",
    resolutionConfidence: meta ? "exact" : "unresolved",
  };
}

export function rgbaToHex(c: {
  r: number;
  g: number;
  b: number;
  a: number;
}): string {
  const h = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return c.a < 1 ? `${base}${h(c.a)}` : base;
}
