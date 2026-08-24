# WP0.2a — Figma variables & identity spike

**Probe:** `node probe.ts m8NQh7FSa3ZTGyQPmPpR6E` (Polaris UI Kit – Community, duplicated into Mike's drafts on a **non-Enterprise** Figma account). Run 2026-08-24. Raw capture: `fixtures/figma/polaris-ui-kit.json` (4.7MB, file version 2391399741860466906).

## Q1 — Does node `boundVariables` appear on non-Enterprise plans?

**YES — the load-bearing assumption holds.** 2,850 of 4,465 nodes carry `boundVariables`; 118 distinct variable IDs referenced. Bindings appear on fills, textRangeFills, fontSize, letterSpacing, itemSpacing, and all four paddings (evidence: probe output samples, e.g. COMPONENT `37:12832` "Variant=auto, Tone=neutral…" binds `itemSpacing`, `paddingLeft/Top/Right/Bottom`).

## Q2 — Can variable IDs resolve to names/keys without the Enterprise endpoint?

**Partially — better than expected.** Two ID shapes observed:

- **Local variables:** `VariableID:24:6778` — opaque node-style ID, **no name resolvable** from file JSON.
- **Remote (library-subscribed) variables:** `VariableID:2254eb44b943f2cd24bcb8b3f3304a9b847c906d/21929:794` — the 40-hex prefix is the variable's **stable key**. Cross-file identity for remote variables comes free by parsing the ID.

`GET /v1/files/:key/variables/local` and `/variables/published` both return **403 "Invalid scope"** — the variables scope is not grantable to this PAT on this plan (the error enumerates every scope the token has; no variables scope exists among them). Confirms the Enterprise gate.

**Consequence for TokenRef (as designed in the plan):** `nativeId` = full VariableID string; `stableKey` = parsed 40-hex prefix when present (remote vars); `resolvedName` = only via Tokens Studio overlay, style names, or a future Enterprise connection; `resolutionConfidence` = "exact" when stableKey present, "unresolved" for bare local IDs.

## Q3 — Do component keys appear in file JSON? Do instances resolve?

**YES, completely.** `file.components` map: 751 entries, **751/751 with non-empty stable `key`** (40-hex publish keys, present even in an unpublished drafts duplicate), plus `componentSetId` linkage (34 component sets) and `documentationLinks` (e.g. Button variants → polaris.shopify.com docs — a free Documentation-dimension signal). INSTANCE nodes (341 observed) carry `componentId` resolvable through the components map → stable key. `FigmaRef {kind:"figma", componentKey}` works exactly as designed; the `figma-node` fallback is rarely needed.

## Q4 — Styles fallback?

**Per-node `styles` map: yes** (651 nodes reference styles). `file.styles` map has 29 entries **with names and stable keys** (`Heading/2xl`, etc.) directly in file JSON — no extra endpoint needed. The published-styles REST endpoints (`/v1/files/:key/styles|components|component_sets`) return **count 0 for a drafts file** — publication-dependent, useless for duplicated community files. Style *names* therefore come from the in-file styles map, not the published endpoints.

## Q5 — Size and shape

Full file (no geometry param): **4.9MB, ~2s fetch**, 4,465 nodes. `depth=1`: 4KB; `depth=2`: 22KB (page/frame skeletons — right for progress UI or page discovery, not extraction). **No streaming parser needed at this scale**; the R7 "fetch whole, parse in worker" decision stands. Real-world Org libraries will be larger; revisit only if a real target OOMs.

## Decisions fed into WP1.2 (FigmaAdapter)

1. Token extraction reads `boundVariables` from file JSON — primary path on all plans.
2. Remote-variable stable keys are parsed from the VariableID prefix; local variables stay opaque (`resolutionConfidence: "unresolved"`) until a Tokens Studio overlay or Enterprise connection names them.
3. Component identity via `file.components[].key`; instances resolve `componentId → key` in the same payload. No published-components endpoint needed.
4. Style names/keys from the in-file `styles` map; never depend on published-library endpoints for drafts/community files.
5. `documentationLinks` and `description` on components feed the Documentation dimension.
