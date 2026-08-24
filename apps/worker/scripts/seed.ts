// Dev seed: workspace + connections from .env. Usage: tsx scripts/seed.ts
import { createDb, encryptToken, parseEncKey, schema } from "@congruo/db";
import { fileURLToPath } from "node:url";

process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
const db = createDb(process.env.DATABASE_URL ?? "");
const key = parseEncKey(process.env.TOKEN_ENC_KEY_V1 ?? "");
const pat = process.env.FIGMA_PAT ?? "";
if (!pat) throw new Error("FIGMA_PAT not set");

const existing = await db.query.workspaces.findFirst();
if (existing) {
  console.log("workspace already exists:", existing.id);
  process.exit(0);
}

const acmeRoot = fileURLToPath(
  new URL("../../../fixtures/acme-ds", import.meta.url),
);
const [ws] = await db
  .insert(schema.workspaces)
  .values({ name: "Polaris Audit" })
  .returning();
if (!ws) throw new Error("insert failed");

await db.insert(schema.connections).values([
  {
    workspaceId: ws.id,
    provider: "figma",
    encryptedToken: encryptToken(pat, key, 1),
    keyVersion: 1,
    config: {
      libraryFileKey: "m8NQh7FSa3ZTGyQPmPpR6E",
      // library doubles as consumer until a real consumer file exists
      consumerFileKeys: ["m8NQh7FSa3ZTGyQPmPpR6E"],
    },
  },
  {
    workspaceId: ws.id,
    provider: "github",
    encryptedToken: encryptToken("local", key, 1),
    keyVersion: 1,
    config: {
      rootDir: acmeRoot,
      repo: "acme/acme-ds",
      sha: "local",
      dsPackage: { name: "@acme/ui", srcGlob: "packages/ui/src/**/*.{ts,tsx}" },
      appGlob: "app/src/**/*.tsx",
    },
  },
]);
console.log("seeded workspace", ws.id);
process.exit(0);
