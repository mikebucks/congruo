"use server";

import { createHash, randomBytes } from "node:crypto";
import { schema } from "@congruo/db";
import { redirect } from "next/navigation";
import { boss, db } from "../../../lib/server";

export async function createShareLink(formData: FormData) {
  const snapshotId = String(formData.get("snapshotId"));
  const token = randomBytes(24).toString("base64url");
  await db()
    .insert(schema.shareLinks)
    .values({
      snapshotId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
    });
  // the plaintext token exists only in this redirect — we store the hash
  redirect(`/share/${token}`);
}

/** Enqueues a Playwright print of a single-use share link; the worker revokes
 * the link after rendering. The PDF appears as a download once sealed. */
export async function exportPdf(formData: FormData) {
  const snapshotId = String(formData.get("snapshotId"));
  const token = randomBytes(24).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db().insert(schema.shareLinks).values({ snapshotId, tokenHash });
  await (await boss()).send("export-pdf", { snapshotId, token, tokenHash });
  redirect(`/report/${snapshotId}?pdf=queued`);
}
