import { blobs } from "../../../../lib/server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(snapshotId)) {
    return new Response("bad id", { status: 400 });
  }
  const key = `pdf/${snapshotId}.pdf`;
  const store = blobs();
  if (!(await store.exists(key))) {
    return new Response("not ready", { status: 404 });
  }
  const body = new Uint8Array(await store.get(key));
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="congruo-audit-${snapshotId.slice(0, 8)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
