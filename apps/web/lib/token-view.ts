import type { TokenRef } from "@congruo/core";

/** Human presentation for a token: prefer the resolved name; a nameless
 * variable displays as its resolved VALUE (what the Enterprise API hides is
 * the name, not what the token is); the raw id is the last resort. */
export function tokenDisplay(
  ref: TokenRef,
  value?: string,
): { label: string; swatch?: string; detail?: string } {
  const swatch =
    value && /^#[0-9a-f]{6,8}$/i.test(value) ? value.toLowerCase() : undefined;
  if (ref.resolvedName) {
    return { label: ref.resolvedName, swatch, detail: value };
  }
  if (value) {
    return {
      label: swatch ? value.toLowerCase() : value,
      swatch,
      detail: shortId(ref),
    };
  }
  return { label: shortId(ref) };
}

function shortId(ref: TokenRef): string {
  return ref.nativeId.replace(/^VariableID:/, "var ").slice(0, 24);
}

/** Rough token kind from the style properties it's bound to. */
export function tokenKind(properties: Iterable<string>): string {
  const props = [...properties];
  const has = (re: RegExp) => props.some((p) => re.test(p));
  if (has(/fill|stroke|color/i)) return "color";
  if (has(/padding|spacing|gap|space/i)) return "spacing";
  if (has(/font|text|letter|typography/i)) return "typography";
  if (has(/radius|corner/i)) return "radius";
  return "other";
}
