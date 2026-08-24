import type { BlobStore } from "@congruo/core";
import type { Db } from "@congruo/db";
import { schema } from "@congruo/db";
import { eq } from "drizzle-orm";
import { chromium } from "playwright";

/** Renders the single-use share link to PDF, stores it, revokes the link.
 * One renderer for screen and PDF — the share page is the layout. */
export async function exportPdf(
  deps: { db: Db; blobs: BlobStore; webBaseUrl: string },
  job: { snapshotId: string; token: string; tokenHash: string },
): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${deps.webBaseUrl}/share/${job.token}`, {
      waitUntil: "networkidle",
    });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });
    const blobKey = `pdf/${job.snapshotId}.pdf`;
    await deps.blobs.put(blobKey, pdf);
    return blobKey;
  } finally {
    await browser.close();
    await deps.db
      .update(schema.shareLinks)
      .set({ revokedAt: new Date() })
      .where(eq(schema.shareLinks.tokenHash, job.tokenHash));
  }
}
