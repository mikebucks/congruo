import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportSummary } from "../../../components/report-view";
import { loadReport } from "../../../lib/report-data";
import { blobs } from "../../../lib/server";
import { createShareLink, exportPdf } from "./share-actions";

export const dynamic = "force-dynamic";

export default async function Report({
  params,
  searchParams,
}: {
  params: Promise<{ snapshotId: string }>;
  searchParams: Promise<{ pdf?: string }>;
}) {
  const { snapshotId } = await params;
  const pdfQueued = (await searchParams).pdf === "queued";
  const data = await loadReport(snapshotId);
  if (!data) notFound();
  const pdfReady = await blobs().exists(`pdf/${snapshotId}.pdf`);

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="flex items-center justify-between">
        <Link className="text-sm text-blue-600 underline" href="/">
          ← runs
        </Link>
        <div className="flex items-center gap-2">
          {pdfReady ? (
            <a
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
              href={`/api/pdf/${snapshotId}`}
            >
              Download PDF
            </a>
          ) : (
            <form action={exportPdf}>
              <input type="hidden" name="snapshotId" value={snapshotId} />
              <button
                type="submit"
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
              >
                {pdfQueued ? "PDF rendering… refresh" : "Export PDF"}
              </button>
            </form>
          )}
          <form action={createShareLink}>
            <input type="hidden" name="snapshotId" value={snapshotId} />
            <button
              type="submit"
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
            >
              Create share link
            </button>
          </form>
        </div>
      </div>
      <h1 className="mt-2 mb-6 text-2xl font-semibold">Audit report</h1>
      <ReportSummary data={data} basePath={`/report/${snapshotId}`} />
    </main>
  );
}
