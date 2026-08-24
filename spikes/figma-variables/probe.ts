// WP0.2a spike: what does Figma file JSON expose on a non-Enterprise plan?
// Usage: node probe.ts <fileKey>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const fileKey = process.argv[2];
if (!fileKey) throw new Error("usage: node probe.ts <fileKey>");

const env = readFileSync(new URL("../../.env", import.meta.url), "utf8");
const pat = env.match(/^FIGMA_PAT=(.+)$/m)?.[1]?.trim();
if (!pat) throw new Error("FIGMA_PAT not set in .env");

const FIXTURES = new URL("../../fixtures/figma/", import.meta.url).pathname;
mkdirSync(FIXTURES, { recursive: true });

async function get(path: string): Promise<{ status: number; body: any; bytes: number }> {
  const res = await fetch(`https://api.figma.com${path}`, {
    headers: { "X-Figma-Token": pat! },
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 300);
  }
  return { status: res.status, body, bytes: text.length };
}

// ---- 1. full file JSON ----
console.log("fetching full file JSON (no geometry)...");
const t0 = Date.now();
const file = await get(`/v1/files/${fileKey}`);
console.log(`GET /v1/files/${fileKey} -> ${file.status}, ${(file.bytes / 1e6).toFixed(1)}MB in ${Date.now() - t0}ms`);
if (file.status !== 200) {
  console.log("body:", file.body);
  process.exit(1);
}
writeFileSync(join(FIXTURES, "polaris-ui-kit.json"), JSON.stringify(file.body));

const doc = file.body;
console.log(`file name: ${doc.name}, version: ${doc.version}, lastModified: ${doc.lastModified}`);

// ---- walk nodes ----
let nodeCount = 0;
let boundVarNodes = 0;
const boundVarSamples: any[] = [];
const varIds = new Set<string>();
let styleNodes = 0;
const styleSamples: any[] = [];
let componentNodes = 0;
let instanceNodes = 0;
const instanceSamples: any[] = [];

function walk(n: any) {
  nodeCount++;
  if (n.boundVariables && Object.keys(n.boundVariables).length) {
    boundVarNodes++;
    if (boundVarSamples.length < 5)
      boundVarSamples.push({ id: n.id, name: n.name, type: n.type, boundVariables: n.boundVariables });
    for (const v of Object.values(n.boundVariables) as any[]) {
      const list = Array.isArray(v) ? v : [v];
      for (const item of list) {
        if (item?.id) varIds.add(item.id);
        else if (typeof item === "object")
          for (const inner of Object.values(item) as any[]) if (inner?.id) varIds.add(inner.id);
      }
    }
  }
  if (n.styles && Object.keys(n.styles).length) {
    styleNodes++;
    if (styleSamples.length < 3) styleSamples.push({ id: n.id, name: n.name, styles: n.styles });
  }
  if (n.type === "COMPONENT" || n.type === "COMPONENT_SET") componentNodes++;
  if (n.type === "INSTANCE") {
    instanceNodes++;
    if (instanceSamples.length < 3)
      instanceSamples.push({ id: n.id, name: n.name, componentId: n.componentId, hasOverrides: !!n.overrides?.length });
  }
  for (const c of n.children ?? []) walk(c);
}
walk(doc.document);

console.log(`\nnodes: ${nodeCount}, with boundVariables: ${boundVarNodes}, distinct variable ids: ${varIds.size}`);
console.log(`nodes with styles: ${styleNodes}, COMPONENT/SET nodes: ${componentNodes}, INSTANCE nodes: ${instanceNodes}`);
console.log("\nboundVariables samples:", JSON.stringify(boundVarSamples.slice(0, 3), null, 1).slice(0, 2000));
console.log("\ninstance samples:", JSON.stringify(instanceSamples, null, 1).slice(0, 800));

// ---- components / componentSets maps (keys!) ----
const comps = Object.entries(doc.components ?? {});
const sets = Object.entries(doc.componentSets ?? {});
console.log(`\nfile.components map: ${comps.length} entries, componentSets: ${sets.length}`);
console.log("component sample:", JSON.stringify(comps.slice(0, 3), null, 1).slice(0, 1200));
const withKeys = comps.filter(([, c]: any) => c.key?.length > 0).length;
console.log(`components with non-empty key: ${withKeys}/${comps.length}`);

// ---- styles map ----
const styles = Object.entries(doc.styles ?? {});
console.log(`\nfile.styles map: ${styles.length} entries`);
console.log("style sample:", JSON.stringify(styles.slice(0, 3), null, 1).slice(0, 800));

// ---- 2. variables endpoints (expect Enterprise gate) ----
for (const ep of ["variables/local", "variables/published"]) {
  const r = await get(`/v1/files/${fileKey}/${ep}`);
  console.log(`\nGET /${ep} -> ${r.status}:`, JSON.stringify(r.body).slice(0, 300));
  if (r.status === 200) writeFileSync(join(FIXTURES, `${ep.replace("/", "-")}.json`), JSON.stringify(r.body));
}

// ---- 3. published styles/components endpoints ----
for (const ep of ["styles", "components", "component_sets"]) {
  const r = await get(`/v1/files/${fileKey}/${ep}`);
  const meta = r.body?.meta;
  const count = meta?.styles?.length ?? meta?.components?.length ?? meta?.component_sets?.length;
  console.log(`GET /${ep} -> ${r.status}, count: ${count ?? JSON.stringify(r.body).slice(0, 200)}`);
  if (r.status === 200) writeFileSync(join(FIXTURES, `published-${ep}.json`), JSON.stringify(r.body));
}

// ---- 4. depth tuning ----
const d1 = await get(`/v1/files/${fileKey}?depth=1`);
const d2 = await get(`/v1/files/${fileKey}?depth=2`);
console.log(`\ndepth=1: ${(d1.bytes / 1e3).toFixed(0)}KB, depth=2: ${(d2.bytes / 1e3).toFixed(0)}KB, full: ${(file.bytes / 1e6).toFixed(1)}MB`);
