import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM with key versioning. Packed format: v<version>:iv:ct:tag (b64).
 * Key rotation = add TOKEN_ENC_KEY_V2, re-encrypt lazily. */

export function parseEncKey(value: string): Buffer {
  const key = Buffer.from(value, value.length === 64 ? "hex" : "base64");
  if (key.length !== 32) {
    throw new Error("token encryption key must be 32 bytes (hex or base64)");
  }
  return key;
}

export function encryptToken(
  plain: string,
  key: Buffer,
  keyVersion: number,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${keyVersion}:${iv.toString("base64")}:${ct.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptToken(
  packed: string,
  keysByVersion: Record<number, Buffer>,
): string {
  const [v, iv, ct, tag] = packed.split(":");
  const version = Number(v?.slice(1));
  const key = keysByVersion[version];
  if (!v?.startsWith("v") || !iv || !ct || !tag || !key) {
    throw new Error(`cannot decrypt token (key version ${v ?? "?"})`);
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
