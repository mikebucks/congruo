import type {
  Analyzer,
  ComponentDefinition,
  Finding,
  Loc,
  PropMapping,
  TokenDefinition,
} from "@congruo/core";
import {
  createFinding,
  matchProps,
  pairComponents,
  tokenKey,
  variantCombinations,
} from "@congruo/core";

export const parity: Analyzer = (graph, mappings) => {
  const findings: Finding[] = [];
  const pairs = pairComponents(graph, mappings);

  // A component can exist in code, Figma, or both — and a workspace can have
  // only one side connected at all. "Missing on the other side" is only a
  // finding when the other side exists; otherwise it's not drift, it's scope.
  const sideExists = (side: "figma" | "code") =>
    graph[side].artifacts.length > 0 || graph[side].definitions.length > 0;
  const figmaExists = sideExists("figma");
  const codeExists = sideExists("code");

  for (const pair of pairs) {
    // component-level presence
    if (pair.figmaDef && !pair.codeDef && !pair.mapping && codeExists) {
      const def = pair.figmaDef;
      // No variants and no props = usually an icon/asset, not a component
      // anyone expects 1:1 in code. Conservative severity keeps trust.
      const hasApi =
        Object.keys(def.variants).length > 0 || def.props.length > 0;
      findings.push(
        createFinding({
          type: "MISSING_IN_CODE",
          subjectRef: def.ref,
          evidence: {
            figmaName: def.name,
            variantCount: variantCombinations(def),
          },
          locations: [],
          severity: hasApi ? "warn" : "info",
        }),
      );
    }
    if (pair.codeDef && !pair.figmaDef && !pair.mapping && figmaExists) {
      findings.push(
        createFinding({
          type: "MISSING_IN_FIGMA",
          subjectRef: pair.codeDef.ref,
          evidence: { codeName: pair.codeDef.name, kind: "component" },
          locations: [],
        }),
      );
    }

    if (pair.figmaDef && pair.codeDef) {
      const propMappings =
        pair.mapping && pair.mapping.propMappings.length > 0
          ? pair.mapping.propMappings
          : matchProps(pair.figmaDef, pair.codeDef);
      findings.push(
        ...propParity(pair.figmaDef, pair.codeDef, propMappings),
        ...tokenParity(pair, mappings),
      );
    }
  }

  findings.push(...hardcodedValues(graph));
  return findings;
};

function propParity(
  figmaDef: ComponentDefinition,
  codeDef: ComponentDefinition,
  propMappings: PropMapping[],
): Finding[] {
  const findings: Finding[] = [];
  const mappedCodeProps = new Set(propMappings.map((m) => m.codeProp));

  for (const prop of codeDef.props) {
    if (prop.name === "children" || mappedCodeProps.has(prop.name)) continue;
    findings.push(
      createFinding({
        type: "MISSING_IN_FIGMA",
        subjectRef: codeDef.ref,
        evidence: {
          codeName: codeDef.name,
          kind: "prop",
          propName: prop.name,
        },
        locations: [],
      }),
    );
  }

  const codeProps = new Map(codeDef.props.map((p) => [p.name, p]));
  for (const pm of propMappings) {
    const valueMap = pm.valueMap;
    if (!valueMap) continue;
    const figmaValues = figmaDef.variants[pm.figmaProp] ?? [];
    const codeValues = codeProps.get(pm.codeProp)?.values ?? [];
    const figmaOnly = figmaValues.filter((v) => !(v in valueMap));
    const mapped = new Set(Object.values(valueMap));
    const codeOnly = codeValues.filter((v) => !mapped.has(v));
    if (figmaOnly.length > 0 || codeOnly.length > 0) {
      findings.push(
        createFinding({
          type: "PROP_VALUES_DIVERGED",
          subjectRef: codeDef.ref,
          evidence: {
            figmaProp: pm.figmaProp,
            codeProp: pm.codeProp,
            figmaOnly,
            codeOnly,
          },
          locations: [],
        }),
      );
    }
  }
  return findings;
}

/** A token mapping is the explicit comparison basis: the Figma side uses a
 * token whose mapped code counterpart never appears in the code component.
 * Without a mapping the comparison is unassessed — never guessed. */
function tokenParity(
  pair: { figmaDef?: ComponentDefinition; codeDef?: ComponentDefinition },
  mappings: Parameters<Analyzer>[1],
): Finding[] {
  const { figmaDef, codeDef } = pair;
  if (!figmaDef || !codeDef) return [];
  const byFigmaToken = new Map(
    mappings.tokenMappings.map((m) => [tokenKey(m.figmaToken), m]),
  );
  const codeTokens = new Set(codeDef.tokensUsed.map((t) => tokenKey(t.token)));
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const used of figmaDef.tokensUsed) {
    const tm = byFigmaToken.get(tokenKey(used.token));
    if (!tm || codeTokens.has(tokenKey(tm.codeToken))) continue;
    const dedupe = `${used.property}:${tokenKey(used.token)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    findings.push(
      createFinding({
        type: "TOKEN_MISMATCH",
        subjectRef: codeDef.ref,
        evidence: {
          property: used.property,
          figmaToken: used.token,
          codeToken: tm.codeToken,
        },
        locations: [],
        severity: tm.source === "user" ? "warn" : "info",
      }),
    );
  }
  return findings;
}

const SOFT_PROPERTIES = new Set([
  "paddingLeft",
  "paddingRight",
  "paddingTop",
  "paddingBottom",
  "itemSpacing",
  "fontSize",
]);

/** Aggregated per (component, property, value); evidence carries the matching
 * token when a token definition's value equals the hardcoded value. */
function hardcodedValues(graph: Parameters<Analyzer>[0]): Finding[] {
  const findings: Finding[] = [];
  for (const side of ["figma", "code"] as const) {
    const tokensByValue = new Map<string, TokenDefinition>();
    for (const t of graph[side].tokens) {
      if (t.value) tokensByValue.set(t.value.toLowerCase(), t);
    }
    for (const def of graph[side].definitions) {
      const grouped = new Map<
        string,
        { value: string; property: string; locations: Loc[] }
      >();
      for (const hv of def.hardcodedValues) {
        const key = `${hv.property}=${hv.value}`;
        const entry = grouped.get(key) ?? {
          value: hv.value,
          property: hv.property,
          locations: [],
        };
        entry.locations.push(hv.location);
        grouped.set(key, entry);
      }
      for (const g of grouped.values()) {
        findings.push(
          createFinding({
            type:
              side === "figma"
                ? "HARDCODED_VALUE_FIGMA"
                : "HARDCODED_VALUE_CODE",
            subjectRef: def.ref,
            evidence: {
              value: g.value,
              property: g.property,
              occurrences: g.locations.length,
              matchingToken:
                tokensByValue.get(g.value.toLowerCase())?.ref ?? null,
            },
            locations: g.locations.slice(0, 10),
            // raw spacing/typography is weaker drift evidence than raw color —
            // many teams never tokenize every padding (M4 gate review)
            severity: SOFT_PROPERTIES.has(g.property) ? "info" : "warn",
          }),
        );
      }
    }
  }
  return findings;
}
