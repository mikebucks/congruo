import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { decryptToken, encryptToken, parseEncKey } from "./crypto";
import * as schema from "./schema";
import { createTestDb } from "./test-db";

const key = randomBytes(32);

test("token round-trips through encrypt/decrypt", () => {
  const packed = encryptToken("figd_secret-pat-value", key, 1);
  expect(packed.startsWith("v1:")).toBe(true);
  expect(decryptToken(packed, { 1: key })).toBe("figd_secret-pat-value");
});

test("wrong key or tampered ciphertext fails closed", () => {
  const packed = encryptToken("figd_secret", key, 1);
  expect(() => decryptToken(packed, { 1: randomBytes(32) })).toThrow();
  expect(() => decryptToken(packed, { 2: key })).toThrow();
  // flip one ciphertext byte (segment 2 of v:iv:ct:tag)
  const parts = packed.split(":");
  const ct = Buffer.from(parts[2] ?? "", "base64");
  if (ct[0] !== undefined) ct[0] ^= 0xff;
  parts[2] = ct.toString("base64");
  expect(() => decryptToken(parts.join(":"), { 1: key })).toThrow();
});

test("parseEncKey accepts 32-byte hex and rejects short keys", () => {
  expect(parseEncKey(randomBytes(32).toString("hex")).length).toBe(32);
  expect(() => parseEncKey("deadbeef")).toThrow();
});

// ---- WP1.3 gate: DB dump greps clean of plaintext tokens ----

let ctx: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  ctx = await createTestDb("congruo_test_crypto");
});
afterAll(() => ctx.close());

test("stored connections never contain the plaintext token", async () => {
  const plaintext = "figd_THE-REAL-TOKEN-0123456789";
  const [ws] = await ctx.db
    .insert(schema.workspaces)
    .values({ name: "sec" })
    .returning();
  if (!ws) throw new Error("insert failed");
  await ctx.db.insert(schema.connections).values({
    workspaceId: ws.id,
    provider: "figma",
    encryptedToken: encryptToken(plaintext, key, 1),
    keyVersion: 1,
    config: { libraryFileKey: "abc" },
  });

  const rows = await ctx.db.select().from(schema.connections);
  const dump = JSON.stringify(rows);
  expect(dump).not.toContain(plaintext);
  expect(dump).not.toContain("THE-REAL-TOKEN");

  const stored = rows[0];
  expect(decryptToken(stored?.encryptedToken ?? "", { 1: key })).toBe(
    plaintext,
  );
});
