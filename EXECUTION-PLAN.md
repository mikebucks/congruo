# Congruo MVP — Execution Plan (rev. 2, post-review)

## Context

Congruo is a greenfield product: an audit tool that compares a design system across its Figma library, consumer Figma files, and the implementing React repo, producing an evidence-backed health report a Design Systems Lead can screenshot into a planning deck. The repo (`/Users/home/Sites/congruo`) is empty except CLAUDE.md. This plan turns the PRD (v0.1, Aug 2026) into an ordered, verifiable roadmap for a solo developer working session-by-session with Claude Code.

**This document is the deliverable** — no code is written on approval. Future sessions execute the work packages, each ending in a concrete verification per CLAUDE.md's goal-driven-execution rule.

Rev. 2 incorporates an architectural review that conditionally approved rev. 1. Four P0 corrections are now baked in: (1) snapshots are fully self-contained — no snapshot reads mutable rows; (2) identity is source-native, never name-based; (3) the canonical model separates definitions, usages, tokens, and provenance instead of one fat component object; (4) token identity is a structured `TokenRef` with explicit resolution confidence — cross-system token parity requires an explicit mapping or reports "unassessed", never a guessed mismatch. `DETACHED_INSTANCES` is dropped (Figma REST cannot evidence detachment; it's Plugin-API-only) and `EXTRACTION_CANDIDATE` moves post-MVP.

Two PRD laws remain non-negotiable: **findings are the atomic unit** (typed, evidenced, machine-usable locations) and **every audit is an immutable snapshot** (deltas come from diffing snapshots).

## Locked decisions (confirmed with user + review)

- **Validation corpus (three-tier, per review):** `fixtures/acme-ds` is the **labeled gold corpus** (every seeded issue has an expected finding; precision/recall measured per finding type). **Shopify Polaris** (community Figma file duplicated into Mike's account + `polaris-react`) is the realistic **stress and manual-review corpus** — an integration/scale test, not a correctness oracle. A **second codebase shape** (different styling tech, e.g. a Tailwind-based OSS DS) guards against extractor overfitting.
- **Auth: PAT-only for the whole MVP.** Figma PAT + GitHub PAT; single shared password → `iron-session` cookie. No OAuth/GitHub App/user table (post-MVP). **Security arrives with credential storage, not later**: token encryption, distinct secrets, and clone sandboxing land in the same work package that first stores a PAT.
- **Runtime: local-first.** docker-compose runs **Postgres 16 only** — pg-boss for jobs (no Redis), filesystem `BlobStore` in dev (no MinIO). Deploy (Vercel + Neon/Railway + R2) only when the share link needs a public URL.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 22 LTS, pnpm 10, Turborepo 2.x, TS 5 strict | PRD-specified |
| Web | **Next.js — current major at scaffold time (16.x)**, App Router; UI + route handlers; no separate `apps/api` | re-baseline versions at scaffolding per review; handlers enqueue, worker executes |
| Jobs | **pg-boss**, explicitly configured (see Worker reliability) | "Postgres for everything"; low-throughput long jobs |
| ORM | **Drizzle** + drizzle-kit | SQL-first, typed JSONB |
| Validation | **Zod v4**; evidence schemas are Zod, `z.toJSONSchema` where a JSON-Schema artifact is wanted | one library doubles as the finding-registry contract |
| Blob storage | `BlobStore` interface: `FsBlobStore` (dev) / S3-client→R2 (prod) | the only non-PRD abstraction, forced by dev/prod |
| Code extraction | `simple-git` shallow clone (sandboxed, see Security) → `react-docgen-typescript` + `ts-morph` | see R6 |
| Fuzzy match | dice coefficient / `fastest-levenshtein` | dumb metric, smart pipeline |
| PDF | **Playwright** printing the share-link page | one report renderer |
| Testing / lint / UI | Vitest + msw fixture replay; Biome; Tailwind 4 + shadcn/ui | speed |

## Monorepo layout

```
congruo/
├── pnpm-workspace.yaml, turbo.json, tsconfig.base.json, biome.json
├── docker-compose.yml              # postgres:16 only
├── .env.example                    # DATABASE_URL, FIGMA_PAT, GITHUB_TOKEN,
│                                   # ADMIN_PASSWORD_HASH, SESSION_SEAL_KEY, TOKEN_ENC_KEY_V1, BLOB_DIR
├── apps/
│   ├── web/                        # Next.js: UI + route handlers
│   └── worker/                     # pg-boss workers running the pipeline
├── packages/
│   ├── core/src/
│   │   ├── refs.ts                 # FigmaRef / CodeRef / TokenRef — source-native identity
│   │   ├── model.ts                # SourceArtifact, ComponentDefinition, ComponentUsage,
│   │   │                           # TokenDefinition, UsageEdge, ExtractionDiagnostic, CanonicalExtract
│   │   ├── findings.ts             # defineFinding() registry + Analyzer signature
│   │   ├── adapter.ts              # SourceAdapter interface
│   │   ├── matcher/                # normalize, fuzzy, prop synonyms
│   │   └── identity.ts             # versioned finding fingerprints
│   ├── ingest-figma/  ingest-code/  analyzers/  scoring/   # scoring/src/rubric.ts = THE config
│   └── db/                         # drizzle schema, client, BlobStore
├── fixtures/
│   ├── figma/                      # captured raw REST JSON (spikes + Polaris)
│   └── acme-ds/                    # labeled gold corpus: seeded React DS + consumer app + expected-findings.json
└── spikes/
    ├── figma-variables/            # WP0.2a script + DECISION.md
    └── code-extraction/            # WP0.2b script + DECISION.md
```

Dependency direction (no cycles): `core` ← `ingest-*`, `analyzers`, `scoring` ← `worker`, `web`; `db` ← `worker`/`web` only. **Analyzers and scoring never import `db`** — pure `(CanonicalGraph, MappingSetRevision, Config) → Finding[]`.

## Identity (P0 — decided in Week 1, before any persistence)

**Component identity is source-native, never name-based:**

```ts
type FigmaRef = { kind: "figma"; fileKey: string; componentKey: string /* stable publish key */ }
             | { kind: "figma-node"; fileKey: string; nodeId: string /* fallback only */ };
type CodeRef  = { kind: "code"; repo: string; sha: string; pkg: string; exportSymbol: string; filePath: string };
type CodeLoc  = { filePath: string; sha: string; line: number; col: number; endLine: number; endCol: number };
```

Mappings and statuses key on these refs — two packages exporting `Button` cannot collide; renames are a mapping edit, not silent identity loss.

**Finding identity is a versioned fingerprint:**

```
fingerprint = hash(fingerprintVersion + findingType + stableSubjectRef + typeSpecificDiscriminator)
```

Locations live in **evidence**, not identity — a line move must not make a persistent problem look "resolved + new". `fingerprintVersion` lets the scheme evolve without corrupting old snapshots. Discriminators are defined per finding type in the registry (e.g. TOKEN_MISMATCH discriminates on `property + figmaTokenRef + codeTokenRef`).

**Token identity is structured, never a bare string:**

```ts
type TokenRef = { nativeId: string; stableKey?: string; collection?: string; mode?: string;
                 resolvedName?: string; source: "figma-variable" | "figma-style" | "tokens-studio" | "code";
                 resolutionConfidence: "exact" | "inferred" | "unresolved" };
```

Cross-system parity (Figma token ↔ code token) requires an explicit **TokenMapping** (auto-proposed from names where confident, user-confirmable like component mappings). Without a mapping, the analyzer emits **"unassessed"** or `info` — never an `error` TOKEN_MISMATCH. Published Styles are treated as a parallel asset system (their own `TokenRef.source`), not a variable-name resolution ladder; a Tokens Studio upload contributes names only where its mapping to Figma variables is demonstrable.

## Canonical model (P0 — separated concerns)

One audit spans a library file, N consumer files, and ≥1 code package — so provenance, definition, and usage are separate entities:

```ts
interface SourceArtifact { id: string; side: "figma" | "code";
  ref: { fileKey?: string; repo?: string; pkg?: string }; version: string /* Figma version | git SHA */;
  role: "library" | "consumer" | "ds-package" | "app" }
interface ComponentDefinition { ref: FigmaRef | CodeRef; artifactId: string; name: string;
  props: { name: string; type: string; values: string[]; required: boolean }[];
  variants: Record<string, string[]>;
  tokensUsed: { token: TokenRef; property: string }[];
  hardcodedValues: { value: string; property: string; location: Loc }[];
  docs: { storyExists: boolean; propsDocumented: boolean; usageProse: string | null } }
interface ComponentUsage { definitionRef: FigmaRef | CodeRef | null /* null = unresolved */;
  artifactId: string; location: Loc; overriddenProps: Record<string, unknown> }
interface TokenDefinition { ref: TokenRef; artifactId: string; value?: string }
interface ExtractionDiagnostic { artifactId: string; kind: "skipped-file" | "parse-error" | "unsupported-pattern" | "api-limit";
  detail: string; location?: Loc }
interface CanonicalExtract { artifacts: SourceArtifact[]; definitions: ComponentDefinition[];
  usages: ComponentUsage[]; tokens: TokenDefinition[]; diagnostics: ExtractionDiagnostic[]; rawPayloadRefs: string[] }
interface SourceAdapter<C> { extract(config: C, deps: { blobs: BlobStore }): Promise<CanonicalExtract> }
```

This makes denominators well-defined ("used in how many consumer files?" = distinct `artifactId` over usages) and gives the coverage contract its raw material (`diagnostics`). Graph JSONB is acceptable storage, but **findings and report summaries are separate rows/read models** — no report page deserializes the graph.

## Snapshot & persistence model (P0 — self-contained snapshots)

```
audit_runs           mutable lifecycle: queued | running | failed | cancelled | succeeded; deterministic run ID
snapshots            created ONLY on success; never updated; carries schemaVersion, fingerprintVersion,
                     frozen copies of: analyzer config, rubric, mapping-set revision, status-set revision
snapshot_sources     one row per artifact: Figma fileKey+version / repo+SHA, role
snapshot_graph       canonical extract JSONB (or blob ref past size guard)
finding_occurrences  immutable rows: fingerprint, type, dimension, severity, subjectRef, evidence JSONB, firstSeenSnapshot
scores               per component/dimension rows + system rollups (read model, derivable)
mappings / component_statuses   MUTABLE working set, revisioned; each audit run freezes the
                     current revision into the snapshot — editing today's mapping never alters yesterday's report
token_mappings       same revisioning pattern
connections          provider, encrypted token (versioned key), config JSONB
share_links          hashed high-entropy token, revocable, optional expiry
+ pg-boss schema
```

The invariant, enforced by a test: **rendering a historical report touches only snapshot-owned rows.**

## Coverage contract (P1 — measurement validity)

Every snapshot records and every report displays: which consumer files were in scope, which packages/extensions were analyzed, files skipped/failed (from `ExtractionDiagnostic`), which token technologies were detected/supported, and which finding types could not be evaluated for which subjects. Scoring rule: **"no findings → 100" is valid only when the dimension was fully evaluated for that component; otherwise the score is `null`/unassessed**, and rollups exclude (never zero-fill) unassessed cells. Scope + extraction confidence render beside every score.

## Worker reliability (P1)

- Deterministic audit-run ID = hash(workspace + source versions + config revision); job send is idempotent on it — **a retry cannot create a duplicate snapshot**.
- pg-boss configured explicitly: job expiration ≫ default 15 min (e.g. 2 h), retry limit + backoff, heartbeat/progress touch from long stages, cancellation checked between pipeline stages.
- Snapshot sealing is the last atomic step: blob writes complete first; a failed/cancelled run leaves an `audit_runs` row and **no partial snapshot**.
- Clone cleanup runs on success, failure, cancellation, and on worker boot (sweep orphaned scratch dirs).
- Delta computation marks a finding "resolved" only if the relevant analyzer and its sources ran successfully in the newer snapshot.

## Security baseline (P1 — lands with WP1.3, not at the end)

- Distinct secrets: `ADMIN_PASSWORD_HASH` (argon2 verify), `SESSION_SEAL_KEY` (iron-session, ≥32 bytes, rotatable — never the admin password), `TOKEN_ENC_KEY_V1` (AES-GCM for PATs, key-versioned column).
- Repo ingestion: approved HTTPS `github.com` URLs only; clone limits (max size, timeout, file count); symlinks not followed; **no execution of repository code or lifecycle scripts** (`--ignore-scripts` everywhere; extraction is parse-only).
- Share links: high-entropy tokens stored hashed, revocable, optional expiry, `noindex` + `Cache-Control: private, no-store` on the share route.
- One-page data-handling doc (ephemeral clones, extracts-not-source, raw-payload retention) written in M4 when the share surface exists.

## Work packages

Solo + Claude Code, ~10 weeks. Sequencing follows the review: contracts + both spikes + report mock in week 1; one complete vertical slice by week 3.

### M0 — Contracts & de-risking (Week 1)

- **WP0.1 Scaffold** — monorepo per layout; current Next.js major; docker-compose Postgres; every package stubbed with one export + passing test. → *Verify:* `pnpm install && pnpm turbo run build typecheck test lint` green from clean checkout.
- **WP0.2a SPIKE: Figma variables & identity.** PAT + duplicated Community file with variables. `DECISION.md` answers with pasted evidence: (1) does node `boundVariables` appear on non-Enterprise plans? (2) are variable IDs resolvable to names/keys without `/variables/local`? (3) do component **keys** (not just node IDs) appear in file JSON for library components, and do consumer-file instances carry a resolvable `componentId → key`? (4) how do per-node `styles` resolve via `/v1/files/:key/styles`? (5) size/shape of a large file → captured into `fixtures/figma/`. Outcome dictates `TokenRef` population and the FigmaRef fallback policy.
- **WP0.2b SPIKE: code extraction.** Run react-docgen-typescript + ts-morph against a Polaris-react checkout and one Tailwind-based DS: does prop extraction survive a pnpm monorepo? What lands in `ExtractionDiagnostic`? → *Verify:* `DECISION.md` with counts + failure modes; informs R6 fallback early, not in week 5.
- **WP0.3 Core contracts** — `refs.ts`, `model.ts`, `identity.ts` (versioned fingerprints + per-type discriminators), `findings.ts` registry skeleton (3–4 types). → *Verify:* registry rejects bad evidence; fingerprints stable across constructions and **invariant under location shifts**; ref equality tests.
- **WP0.4 DB + persistence model** — full schema above incl. `audit_runs`/`snapshots`/revisioned mappings; FsBlobStore. → *Verify:* migrate on fresh container; snapshot round-trip deep-equals; **self-containment test:** mutate the working mapping set after sealing, historical snapshot render output unchanged.
- **WP0.5 Report mock from fixture** — static summary page rendered from a hand-written fixture snapshot (per review's week-1 sequencing). → *Verify:* screenshot review; proves read-model shape before any real ingestion.

### M1 — Vertical slice (Weeks 2–3)

Goal: **library + one consumer file + one repo → mapping → three finding types → persisted immutable report**, end-to-end, however narrow.

- **WP1.1 Figma REST client** — typed fetch, PAT header, 429 backoff. → *Verify:* msw replay of spike fixtures + live smoke script.
- **WP1.2 FigmaAdapter (narrow)** — components/component sets + variant props, `boundVariables` → TokenRefs, styles as parallel TokenRefs, hardcoded fills where nothing bound, consumer INSTANCE usages with resolved definition refs; diagnostics for everything skipped; raw payloads → BlobStore. → *Verify:* snapshot tests; counts match hand-counted fixture values; diagnostics non-empty where expected.
- **WP1.3 CodeAdapter (narrow) + connections + security baseline** — local-dir mode first (clone-at-SHA is a sandboxed thin wrapper, deletion asserted in a test; preserves PRD's "CLI-able later"); DS package exports/props via docgen (or ts-morph fallback per WP0.2b); consumer JSX usages resolved to DS imports. **Connection storage ships with encryption + distinct secrets (Security baseline).** → *Verify:* acme-ds extract matches expected snapshot; DB dump greps clean of plaintext tokens.
- **WP1.4 Matcher v1 + three analyzers + pipeline** — exact + normalized name **proposal** (identity stays ref-based; names only propose mappings): ≥0.85 auto, 0.6–0.85 suggested, else unmatched — never silently paired. Analyzers: MISSING_IN_CODE, HARDCODED_VALUE_CODE, UNUSED_COMPONENT. Worker pipeline with run lifecycle, idempotent run ID, seal-last semantics. → *Verify:* the M1 gate — click Run against real Polaris duplicate + acme-ds, get an immutable report with three evidenced finding types; kill the worker mid-run → no partial snapshot; re-run → no duplicate.

### M2 — Breadth: extraction, mapping UI, coverage (Weeks 4–5)

- **WP2.1 Gold corpus completion** — `fixtures/acme-ds` grown to ~8 components with seeded issues (`ButtonNew`, unused variant, hardcoded hex beside its token, `isDisabled` vs `Disabled`, undocumented component, one story) **plus `expected-findings.json`** labeling every seeded issue by finding type. → *Verify:* `tsc` clean; labels reviewed.
- **WP2.2 Full extraction breadth** — Figma: typography/spacing/strokes, component-set variant values, multi-consumer-file support. Code: token-pattern config (CSS custom props, `theme.` lookups, Tailwind classes), local-component and raw-styled-element census (coverage denominator). Diagnostics + coverage contract populated end-to-end. → *Verify:* coverage block renders on report; second-codebase-shape smoke run completes with plausible diagnostics.
- **WP2.3 Matcher v2 + prop/token mapping** — fuzzy tier, `is/has` stripping, synonym table, variant-value matching; **TokenMapping** auto-proposals. → *Verify:* table-driven tests (DsButton↔Button, ButtonNew ≠ Button, isDisabled↔disabled, Size=lg↔size="lg"); manual precision pass on Polaris pairs before analyzers consume them.
- **WP2.4 Mapping review UI + statuses** — mapping table (confidence badges, fix/unlink/assign), token-mapping review, status dropdown; edits create new revisions. → *Verify:* PRD M2 gate — set override + status, re-audit: respected in the new snapshot, absent from the old one.

### M3 — Analyzers + scoring (Weeks 6–7)

All analyzers pure, tested via an in-memory graph builder; no DB or network in this milestone's tests.

- **WP3.1 Complete finding registry** — Parity: MISSING_IN_CODE/FIGMA, PROP_VALUES_DIVERGED, TOKEN_MISMATCH (requires TokenMapping; else unassessed/`info`), HARDCODED_VALUE_FIGMA/CODE (evidence includes `matchingToken`); Complexity: REDUNDANT_COMPONENT, UNUSED_PROP/VARIANT, PROP_EXPLOSION(48); Adoption: UNUSED_COMPONENT, SINGLE_FILE_ADOPTION, DEPRECATED_STILL_USED; Docs: NO_STORY, PROPS_UNDOCUMENTED, NO_USAGE_GUIDANCE. **No DETACHED_INSTANCES** (not evidencable via REST). Each type declares its fingerprint discriminator. → *Verify:* registry test validates an example payload + discriminator per type.
- **WP3.2–3.5 One WP per dimension** (Parity → Complexity → Adoption incl. coverage % + token health → Documentation). Status gating as one shared post-filter; severity policy: uncertain → `info`; unassessed ≠ score 100. → *Verify each:* table-driven tests incl. gating + unassessed cases; **precision/recall per finding type against `expected-findings.json`** — target 100% on the gold corpus, misses itemized.
- **WP3.6 Scoring** — rubric config; 100 − reach-scaled penalties, floor 0; `null` for unevaluated dimensions; topline = coverage-weighted mean over assessed cells. → *Verify:* no findings + fully evaluated → 100; exempt/unassessed → null; floor holds.
- **WP3.7 Pipeline completion** — all analyzers wired; `firstSeenSnapshot` via fingerprints. → *Verify:* determinism (same fixtures twice → identical fingerprints and scores); live Polaris run reviewed for scale/latency.

### M4 — Report = sellable audit (Weeks 8–9)

- **WP4.1 Audit summary** (topline, coverage %, token health, dimension bars, scope/confidence block — screenshot-legible to a VP). **WP4.2 Component table + detail** (evidence rendered per type; deep links `figma.com/design/:key?node-id=`, GitHub `blob/:sha/path#L`). **WP4.3 Punch-list** (severity × reach, filterable). **WP4.4 Share + PDF** (`/share/:token` per security baseline; worker Playwright job → PDF → BlobStore). → *Verify per screen:* Playwright screenshot review; PDF gate: "could a DS Lead paste this into a deck without apologizing?"
- **WP4.5 Operational hardening** — clone-sweep on boot verified, run cancellation UI, data-handling one-pager. → *Verify:* cancel mid-run → clean state; orphan-dir sweep test.
- **Milestone gate:** full Polaris audit reviewed finding-by-finding; false positives fixed or demoted to `info`; rubric tuned once here. **This is the sellable audit.**

### M5 — Deltas + regression (Week 10)

- **WP5.1 Deltas** — diff snapshots by fingerprint (new/resolved/persisting; "resolved" only when the analyzer + sources ran successfully); score deltas + "since last audit" strip. → *Verify:* mutate acme-ds (fix one issue, add one), re-audit → exactly one resolved + one new; a moved line produces **no** delta.
- **WP5.2 Regression suite** — gold-corpus precision/recall as a CI-style gate; second-codebase-shape run added to smoke set. → *Verify:* one command reports per-type P/R.
- **Post-MVP (explicitly deferred):** EXTRACTION_CANDIDATE clustering (separate recommendation product with a large false-positive surface — review verdict), Figma OAuth + GitHub App, deploy.

## Fixtures vs credentials

Only the **week-1 spikes need credentials** (a Figma PAT; public repos need none). Spike captures become the fixture corpus, so one afternoon with a PAT unblocks weeks of offline work: core, analyzers, scoring, matcher, code ingest (local-dir mode), all report UI (rendered from fixture snapshots), deltas. Live smoke tests and milestone gates are the only other credentialed moments.

## Riskiest decisions

- **R1 — Token identity across systems.** Resolved by design: `TokenRef` + explicit TokenMapping + resolutionConfidence; parity without a mapping is unassessed/`info`, never `error`. WP0.2a validates what Figma file JSON actually exposes per plan tier.
- **R2 — pg-boss over BullMQ+Redis** — one less service; explicit expiration/retry/heartbeat config is mandatory (Worker reliability), not defaults.
- **R3 — Drizzle over Prisma** — typed JSONB, no engine binary.
- **R4 — No `apps/api`** — route handlers + worker.
- **R5 — PAT-first** — connect ceremony is for selling, not building; but credential *security* ships with the first stored credential (WP1.3).
- **R6 — react-docgen-typescript in pnpm monorepos** — de-risked by WP0.2b spike in week 1; fallback ts-morph TypeChecker walking behind the adapter boundary.
- **R7 — Large Figma files** — no streaming parser in MVP; fetch geometry-omitted, raw → BlobStore, generous heap; the blob→parse seam exists if `stream-json` becomes necessary.
- **R8 — Graph JSONB** — storage only; findings/scores/summaries are rows; report pages never deserialize the graph; loud log past ~50MB.
- **R9 — Identity schemes** — source-native refs + versioned fingerprints decided in WP0.3; `fingerprintVersion` is the escape hatch if the scheme must evolve.
- **R10 — Matcher precision** — names only *propose*, refs *are* identity; never auto-pair below 0.85; manual Polaris precision pass before analyzers consume mappings.

## CLAUDE.md compliance

Abstractions: `SourceAdapter`, finding registry, rubric config (PRD-mandated) + `BlobStore` (forced by dev/prod). No repository pattern, DI container, event bus, multi-tenancy, or plugin discovery. Every WP is loop-until-green via `pnpm turbo run build typecheck test lint` plus its listed integration check.

## Verification (plan-level gates)

- **M0:** contracts tested (fingerprint stability, snapshot self-containment); both spike DECISION.md files answered with evidence; report mock rendered.
- **M1:** end-to-end vertical slice on real sources; kill-mid-run → no partial snapshot; re-run → no duplicate.
- **M2:** corrected mapping + statuses respected in new snapshot, absent from old.
- **M3:** deterministic pipeline; 100% precision/recall on the labeled gold corpus (misses itemized).
- **M4:** finding-by-finding Polaris review; deck-worthy PDF. **Sellable audit.**
- **M5:** exact expected delta on fixture mutation; line-move produces no delta; per-type P/R report runs as one command.
