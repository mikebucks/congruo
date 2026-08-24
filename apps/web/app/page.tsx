import { schema } from "@congruo/db";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "../lib/server";
import { cancelRun, startAudit } from "./actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const workspace = await db().query.workspaces.findFirst();
  if (!workspace) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">Congruo</h1>
        <p className="mt-4 text-neutral-600">
          No workspace yet.{" "}
          <Link className="text-blue-600 underline" href="/connect">
            Connect your sources
          </Link>{" "}
          to run your first audit.
        </p>
      </main>
    );
  }

  const runs = await db().query.auditRuns.findMany({
    where: eq(schema.auditRuns.workspaceId, workspace.id),
    orderBy: desc(schema.auditRuns.createdAt),
  });
  const snapshots = await db().query.snapshots.findMany({
    where: eq(schema.snapshots.workspaceId, workspace.id),
    orderBy: desc(schema.snapshots.createdAt),
  });
  const snapshotByRun = new Map(snapshots.map((s) => [s.runId, s]));

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{workspace.name}</h1>
          <Link className="text-sm text-blue-600 underline" href="/mapping">
            Mapping review
          </Link>
        </div>
        <form action={startAudit}>
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <button
            type="submit"
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            Run audit
          </button>
        </form>
      </div>

      <h2 className="mt-8 text-sm font-medium text-neutral-500">Audit runs</h2>
      <ul className="mt-2 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        {runs.length === 0 && (
          <li className="p-4 text-sm text-neutral-500">No runs yet.</li>
        )}
        {runs.map((run) => {
          const snap = snapshotByRun.get(run.id);
          return (
            <li key={run.id} className="flex items-center gap-3 p-4 text-sm">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  run.status === "succeeded"
                    ? "bg-green-100 text-green-800"
                    : run.status === "failed"
                      ? "bg-red-100 text-red-800"
                      : "bg-neutral-100 text-neutral-600"
                }`}
              >
                {run.status}
              </span>
              <span className="flex-1 font-mono text-xs text-neutral-500">
                {run.id}
              </span>
              <span className="text-xs text-neutral-400">
                {run.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              </span>
              {snap && (
                <Link
                  className="text-blue-600 underline"
                  href={`/report/${snap.id}`}
                >
                  report
                </Link>
              )}
              {(run.status === "queued" || run.status === "running") && (
                <form action={cancelRun}>
                  <input type="hidden" name="runId" value={run.id} />
                  <button
                    type="submit"
                    className="text-xs text-red-700 underline"
                  >
                    cancel
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
