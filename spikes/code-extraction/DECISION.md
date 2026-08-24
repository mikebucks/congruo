# WP0.2b Spike: React component API extraction — react-docgen-typescript vs ts-morph

Date: 2026-08-24. Throwaway spike; scripts in this dir (`extract.ts` = react-docgen-typescript, `extract-tsmorph.ts` = ts-morph). Versions: react-docgen-typescript 2.4.0, ts-morph 27.x, typescript 5.9.3, node 24.

Targets tested:

- **Shopify Polaris** (pnpm monorepo, `polaris-react` package, 122 component dirs, classic hand-written `interface XProps` style). Installed with `pnpm install --ignore-scripts` — succeeded.
- **shadcn-ui/ui** (pnpm monorepo, Next.js app, components in `apps/v4/registry/new-york-v4/ui`, Tailwind + cva + `React.ComponentProps<...>` style). Installed with `pnpm install --ignore-scripts` — succeeded.

Note: the spike dir sits outside the congruo pnpm workspace; `pnpm install --ignore-workspace` works standalone (no `pnpm-workspace.yaml` shim needed).

## 1. Does react-docgen-typescript work on a real pnpm monorepo DS?

**Yes, and it is fast.** Polaris, with node_modules installed, using the repo's own tsconfig (`withCustomConfig`):

```
files: 233
parse time: 595ms
components found: 269
files yielding no components: 7
components with any-typed props: 19/269
components with zero props: 32
```

shadcn (61 files): 331 components, parse time 1239ms. Both far below any performance concern.

**Without node_modules** (tested by hiding Polaris' node_modules, and on shadcn pre-install):

- Using the repo tsconfig **crashes immediately** when it `extends` a package: `Error: TS6053: File '@shopify/typescript-configs/library' not found.` (thrown from `withCustomConfig`).
- Falling back to a default compilerOptions **partially works when props are hand-written interfaces**: Polaris Button still yielded all 34 props with names/required/descriptions intact; only cross-module types degraded (`icon?: any` instead of `IconSource | ReactElement`).
- It **completely fails when props are derived types**: shadcn without deps reported 327 components but `props: 0` for essentially all of them (325/327 zero-prop), because `React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>` cannot resolve without `@types/react` and `class-variance-authority`.

Conclusion: node_modules is effectively required for trustworthy extraction; without it you get silent emptiness, not errors.

## 2. Prop extraction quality

**Polaris (docgen, with deps): excellent.** Real dump for Button (34 props, 0 `any`):

```
children?: string | string[]  // The content to display inside the button
size?: enum  // Changes the size of the button, giving it more or less padding
disclosure?: boolean | "down" | "up" | "select"  // Displays the button with a disclosure icon...
icon?: IconSource | ReactElement<any, ...>  // Icon to display to the left of the button content
variant?: enum  // Changes the visual appearance of the Button.
url?: string  // A destination to link to, rendered in the href attribute...
```

Name/type/required/description all usable. Badge (6 props) and TextField (55 props, `label` correctly required) equally clean. Union-of-literals props come back as `type.name: "enum"` with values available via `shouldExtractLiteralValuesFromEnum`.

**shadcn (docgen, with deps): good, with one required config.** With `propFilter` excluding props declared in node_modules:

```
Button: variant?: "link" | "default" | "destructive" | "outline" | "secondary" | "ghost" | null
        size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg" | null
        asChild?: boolean
Input:  props: 0
```

cva `VariantProps` resolve to exact literal unions — very usable. `Input` legitimately has zero own props (it is purely `ComponentProps<"input">`); the audit tool must distinguish "no own props, all inherited from HTML" from "extraction failed".

**The HTML-attribute flood is real.** Without `propFilter`, `ComponentProps<'button'>` explodes: Button = **292 props**, Input = **309 props**, Badge = **282**, and 293/331 components then contain an `any` (e.g. `aria-*`/CSS passthroughs). The filter-by-declaration-file approach (skip props whose `parent.fileName` includes `node_modules`) cleanly separates own props from inherited DOM props and is the mechanism the production adapter should use — ideally keeping a count of filtered inherited props rather than discarding the fact.

Where garbage appears:

- 19/269 Polaris components have at least one `any` prop even fully installed (e.g. generic render-prop types).
- Descriptions are empty for shadcn (no JSDoc in source) — absence of docs is a DS-quality finding, not an extractor failure.
- docgen over-detects: any exported function/const whose type looks component-ish is reported (327 "components" in 61 shadcn files even with zero resolvable types), and it also walks nested subcomponent copies (found two distinct `TextField`s in Polaris — Combobox's internal one and the public one). Consumers need to dedupe/scope by public entry point.

## 3. Does ts-morph reproduce the essential info?

**Mostly yes, at similar speed (456ms for 3 files incl. program setup) but with more sharp edges.** Same three Polaris components via TypeChecker (`getExportedDeclarations` → call signature returning JSX → first param type → `getProperties()`):

- Prop counts match: Button 34/34, Badge 6/6, TextField 54 vs docgen's 55 (one-off discrepancy in how an overloaded/spread member is counted).
- Required/optional matches (`symbol.isOptional()`).
- Literal unions come out fully expanded: `size?: "micro" | "slim" | "medium" | "large" | undefined` — arguably better than docgen's opaque `"enum"`.
- **Type text is worse by default**: named imported types print as absolute-path imports, e.g. `tone?: import("/private/tmp/.../scratchpad/polaris/.../types").Tone` — needs `TypeFormatFlags` tuning per callsite.
- **JSDoc extraction is manual** (leading comment ranges → strip `/** */` yourself); docgen gives parsed description + `@default` tags for free.
- **No propFilter equivalent**: on shadcn, ts-morph returned the full flood (Button 293, Badge 282, Input 310 props); filtering inherited DOM props means walking each prop symbol's declaration source files yourself.
- **Component detection is manual**: the "call signature returning something matching /Element|ReactNode/" heuristic works for plain functions and forwardRef, but misses/false-positives on HOC-wrapped or generic components without more code.

The spike scripts are 69 LOC (docgen) vs 63 LOC (ts-morph), but the ts-morph version is missing propFilter, JSDoc tag parsing, defaultValue extraction, enum value extraction, and robust component detection — all free in docgen. A production-parity ts-morph extractor is realistically 3-5x the code.

## 4. RECOMMENDATION for WP1.3 CodeAdapter

**Primary: react-docgen-typescript** (`withCustomConfig` on the package's own tsconfig), configured with:

- `propFilter` dropping props declared under `node_modules` (but counting them, so inherited-DOM-prop volume is reported, not lost),
- `shouldExtractLiteralValuesFromEnum: true`, `shouldRemoveUndefinedFromOptional: true`,
- dedupe by resolved file path / public export surface (nested internal components shadow public ones by displayName).

**Fallback: not ts-morph symbol walking for props.** ts-morph adds real code for no extraction-quality gain (its only win, expanded literal unions, is available via docgen options). Instead the fallback ladder should be *within* docgen inputs:

1. repo tsconfig → 2. if tsconfig fails to load (e.g. `extends` into missing node_modules → TS6053), retry with a sane default compilerOptions and emit a diagnostic → 3. surface per-component emptiness diagnostics rather than crashing.

Keep ts-morph in the toolbox only if WP1.x later needs things docgen cannot do (walking re-export graphs to establish the public API surface, usage-site analysis) — not for prop extraction.

**ExtractionDiagnostic kinds needed (all observed in this spike):**

- `TSCONFIG_UNRESOLVED` — tsconfig load threw (TS6053 `extends` not found); extractor fell back to default compiler options.
- `DEPS_NOT_INSTALLED` / `TYPES_UNRESOLVED` — imported types resolved to `any` or props came back empty because node_modules is absent; distinguishes "shadcn-style silent zero props" from a real empty API.
- `PROP_TYPE_ANY` — per-prop: type resolved to `any` (19/269 Polaris components even fully installed).
- `PROPS_ALL_INHERITED` — component has zero own props, everything filtered as node_modules-declared (shadcn `Input`; 137/331 shadcn components).
- `FILE_NO_COMPONENTS` — file parsed but yielded no components (7/233 Polaris files; expected for util files but should be visible).
- `DUPLICATE_COMPONENT_NAME` — same displayName extracted from multiple files (Polaris `TextField` x2); adapter must pick the public one.
- `MISSING_DESCRIPTIONS` — component/props extracted with no JSDoc (all of shadcn); feeds the audit's documentation-coverage signal rather than being an error.

**Operational constraints for the adapter:** it must run `pnpm|npm install --ignore-scripts` (or require a pre-installed workspace) before extraction — cloned-repo lifecycle scripts must never run — and installs are the dominant cost (repo + deps: Polaris 1.2GB, shadcn 1.6GB; extraction itself is sub-2s per package).
